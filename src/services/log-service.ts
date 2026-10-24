import type { Table } from 'dexie';
import { ErrorCode } from '@/types/error-codes.d';
import { db } from './database';
import type { ApprovalOutcome } from './database';

export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

type LogContext = Record<string, unknown>;

type PersistedLogAccount = string | null;

type PersistedLogHostname = string | null;

/** The newest approval records kept; older ones are deleted as new ones arrive (threat model T28). */
export const MAX_APPROVAL_LOG_ENTRIES = 500;

/** The newest exception records kept. */
export const MAX_EXCEPTION_LOG_ENTRIES = 200;

/**
 * Error class names that may be recorded. A name outside this list is recorded as `Error`: a
 * custom error's `name` is an ordinary writable property and could carry anything.
 */
const KNOWN_ERROR_NAMES: ReadonlySet<string> = new Set([
  // JavaScript
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  // DOM and IndexedDB
  'AbortError',
  'ConstraintError',
  'DataCloneError',
  'DataError',
  'InvalidStateError',
  'NetworkError',
  'NotAllowedError',
  'NotFoundError',
  'OperationError',
  'QuotaExceededError',
  'SecurityError',
  'TimeoutError',
  'TransactionInactiveError',
  'UnknownError',
  'VersionError',
  // Dexie
  'DatabaseClosedError',
  'MissingAPIError',
  'ModifyError',
  'OpenFailedError',
  'ReadOnlyError',
  'SchemaError',
  'UpgradeError',
  // Porwr
  'BackgroundBridgeError',
  'BackgroundTimeoutError',
]);

/** Error codes that may be recorded: Porwr's own, never one a dependency invented. */
const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  ...Object.values(ErrorCode),
  'VAULT_LOCKED',
  'NOT_FOUND',
]);

/**
 * Identify a failure without repeating anything it says.
 *
 * Error text is not under Porwr's control: a library may echo its input, which can be an event, a
 * key, plaintext, or an invoice, in any shape, and may put it in `name` or `code` as easily as in
 * `message`. So nothing the error carries is copied: only a class name and a code that appear in
 * fixed lists are kept (#144, threat model T11).
 */
export const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return 'non-Error value';
  const name = KNOWN_ERROR_NAMES.has(error.name) ? error.name : 'Error';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && KNOWN_ERROR_CODES.has(code) ? `${name} ${code}` : name;
};

export class LogService {
  private readonly debugMode: boolean;

  constructor() {
    // Only tests turn on debug and info output. The old `process.env.DEBUG === 'true'` check
    // compared against the boolean Quasar injected, so it never enabled anything (#210).
    this.debugMode = import.meta.env.MODE === 'test';
  }

  private normalizeNullableString(value?: string | null): string | null {
    return value ?? null;
  }

  private shouldEmit(level: LogLevel): boolean {
    if (level === LogLevel.DEBUG) {
      return this.debugMode;
    }

    if (level === LogLevel.INFO) {
      return this.debugMode;
    }

    return true;
  }

  private write(level: LogLevel, formattedMessage: string, context?: LogContext): void {
    switch (level) {
      case LogLevel.ERROR:
        console.error(formattedMessage, context);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage, context);
        break;
      case LogLevel.INFO:
        console.info(formattedMessage, context);
        break;
      case LogLevel.DEBUG:
        console.debug(formattedMessage, context);
        break;
    }
  }

  /**
   * Record a failure. `context` is a fixed description written by the caller, such as
   * `blossom.upload failed`; `error` contributes only its class name and code (`describeError`).
   */
  async logException(
    context: string,
    error?: unknown,
    account?: string | null,
    hostname?: string | null,
  ): Promise<void> {
    const persistedAccount: PersistedLogAccount = this.normalizeNullableString(account);
    const persistedHostname: PersistedLogHostname = this.normalizeNullableString(hostname);
    const safeMessage = error === undefined ? context : `${context}: ${describeError(error)}`;

    try {
      await this.addBounded(
        db.exceptions,
        {
          dateTime: new Date().toISOString(),
          message: safeMessage,
          account: persistedAccount,
          hostname: persistedHostname,
        },
        MAX_EXCEPTION_LOG_ENTRIES,
      );
      this.log(LogLevel.ERROR, safeMessage, {
        account: persistedAccount,
        hostname: persistedHostname,
      });
    } catch (error: unknown) {
      this.log(LogLevel.ERROR, '[LogService] Failed to log exception', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Record what happened to an approval request.
   *
   * Called on the terminal transition, not when the site asks: a rejected request must not be
   * recorded the same way as an approved one.
   */
  async logApproval(
    eventKind: number | string,
    hostname: string,
    account?: string | null,
    outcome: ApprovalOutcome = 'unknown',
  ): Promise<void> {
    const persistedAccount: PersistedLogAccount = this.normalizeNullableString(account);

    try {
      await this.addBounded(
        db.approvals,
        {
          dateTime: new Date().toISOString(),
          eventKind,
          hostname,
          account: persistedAccount,
          outcome,
        },
        MAX_APPROVAL_LOG_ENTRIES,
      );
      this.log(LogLevel.DEBUG, `Approval ${outcome} for kind ${eventKind} on ${hostname}`, {
        account: persistedAccount,
      });
    } catch (error: unknown) {
      this.log(LogLevel.ERROR, '[LogService] Failed to log approval', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Add a record and delete the oldest beyond `max`, in one read-write transaction.
   *
   * Dexie serialises read-write transactions on a table, so concurrent callers each see the count
   * their own insert produced and none deletes rows another already removed.
   */
  private async addBounded<T>(
    table: Table<T, number>,
    record: Omit<T, 'id'>,
    max: number,
  ): Promise<void> {
    await db.transaction('rw', table, async () => {
      await table.add(record as T);
      await this.prune(table, max);
    });
  }

  /** Delete the oldest records beyond `max`. */
  private async prune<T>(table: Table<T, number>, max: number): Promise<void> {
    const excess = (await table.count()) - max;
    if (excess > 0) {
      // By primary key, which is insertion order: `dateTime` follows the system clock, which can move
      // backwards and would make the newest row look oldest.
      await table.orderBy(':id').limit(excess).delete();
    }
  }

  /**
   * Bring both tables within their caps. Run at background startup, so history kept before the caps
   * existed, or by a table that receives no new record, is bounded too.
   */
  async enforceRetention(): Promise<void> {
    await db.transaction('rw', db.approvals, db.exceptions, async () => {
      await this.prune(db.approvals, MAX_APPROVAL_LOG_ENTRIES);
      await this.prune(db.exceptions, MAX_EXCEPTION_LOG_ENTRIES);
    });
  }

  /** Delete every approval and exception record, for every account. */
  async clearHistory(): Promise<void> {
    await Promise.all([db.approvals.clear(), db.exceptions.clear()]);
  }

  log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldEmit(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] ${message}`;
    this.write(level, formattedMessage, context);
  }

  async getExceptions(account?: string | null) {
    if (account) {
      return await db.exceptions.where('account').equals(account).reverse().sortBy('dateTime');
    }
    return await db.exceptions.orderBy('dateTime').reverse().toArray();
  }

  async getApprovals(account?: string | null) {
    if (account) {
      return await db.approvals.where('account').equals(account).reverse().sortBy('dateTime');
    }
    return await db.approvals.orderBy('dateTime').reverse().toArray();
  }

  wrapWithLogging<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
    serviceName: string,
    methodName: string,
  ): (...args: TArgs) => Promise<TResult> {
    return async (...args: TArgs): Promise<TResult> => {
      this.log(LogLevel.DEBUG, `Calling ${serviceName}.${methodName}`, {
        argCount: args.length,
      });
      try {
        const result = await fn(...args);
        this.log(LogLevel.DEBUG, `${serviceName}.${methodName} completed successfully`, {
          resultType: typeof result,
        });
        return result;
      } catch (error: unknown) {
        this.log(LogLevel.ERROR, `${serviceName}.${methodName} failed: ${describeError(error)}`);
        void this.logException(`${serviceName}.${methodName} failed`, error);
        throw error;
      }
    };
  }
}

export const logService = new LogService();
