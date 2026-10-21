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

/** The longest message persisted or written to the console for a failure. */
export const MAX_LOG_MESSAGE_LENGTH = 300;

/**
 * Patterns for material that must never reach a log: hex keys, event ids and signatures, bech32 secret keys,
 * Lightning invoices, and serialised objects such as events. Order matters: JSON first, so a key
 * inside an event is removed with the event.
 */
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/\{[\s\S]*\}/g, '[object]'],
  [/\b(?:nsec|ncryptsec)1[02-9ac-hj-np-z]+/gi, '[secret key]'],
  [/\bln(?:bcrt|bc|tbs|tb)[0-9a-z]+/gi, '[invoice]'],
  [/\b[0-9a-f]{64,}\b/gi, '[hex]'],
];

/**
 * Make an error message safe to persist or print.
 *
 * Thrown messages are not under Porwr's control: a library may echo its input, which can be an
 * event, a key, or an invoice. Every failure that is logged passes through here first (#144, T11).
 */
export const sanitizeLogMessage = (message: string): string => {
  const redacted = REDACTIONS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    message,
  );
  return redacted.length > MAX_LOG_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_LOG_MESSAGE_LENGTH)}…`
    : redacted;
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

  async logException(
    message: string,
    account?: string | null,
    hostname?: string | null,
  ): Promise<void> {
    const persistedAccount: PersistedLogAccount = this.normalizeNullableString(account);
    const persistedHostname: PersistedLogHostname = this.normalizeNullableString(hostname);
    const safeMessage = sanitizeLogMessage(message);

    try {
      await db.exceptions.add({
        dateTime: new Date().toISOString(),
        message: safeMessage,
        account: persistedAccount,
        hostname: persistedHostname,
      });
      await this.prune(db.exceptions, MAX_EXCEPTION_LOG_ENTRIES);
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
      await db.approvals.add({
        dateTime: new Date().toISOString(),
        eventKind,
        hostname,
        account: persistedAccount,
        outcome,
      });
      await this.prune(db.approvals, MAX_APPROVAL_LOG_ENTRIES);
      this.log(LogLevel.DEBUG, `Approval ${outcome} for kind ${eventKind} on ${hostname}`, {
        account: persistedAccount,
      });
    } catch (error: unknown) {
      this.log(LogLevel.ERROR, '[LogService] Failed to log approval', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Delete the oldest records beyond `max`, so local history stays bounded. */
  private async prune(
    table: typeof db.exceptions | typeof db.approvals,
    max: number,
  ): Promise<void> {
    const excess = (await table.count()) - max;
    if (excess > 0) {
      await table.orderBy('dateTime').limit(excess).delete();
    }
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
        const message = sanitizeLogMessage(error instanceof Error ? error.message : String(error));
        this.log(LogLevel.ERROR, `${serviceName}.${methodName} failed: ${message}`);
        void this.logException(`${serviceName}.${methodName} error: ${message}`);
        throw error;
      }
    };
  }
}

export const logService = new LogService();
