import { LogLevel, logService } from './log-service';
import type { BridgeAction, BridgeRequestMap, BridgeResponsePayload } from '@/types/bridge';

/**
 * Background messaging client.
 *
 * Prefers the Quasar bridge and falls back to `chrome.runtime.sendMessage`, which is more
 * reliable across differing context lifetimes.
 *
 * The sidebar is the first Porwr surface that stays open across service-worker restarts, so a
 * single failed call is not evidence that the channel is gone. Calls are retried with a short
 * backoff before the caller sees a failure; the background restarts quickly, and a panel that
 * silently stops talking to it is worse than one that never opened.
 *
 * A call that signs, publishes, sends or pays is not retried, or sent again another way, once it
 * has timed out. The background may have received it and still be working, so sending it again
 * could sign, publish or pay twice (#265). Every other call is safe to repeat and retries as above.
 */

const CALL_TIMEOUT_MS = 5000;

/**
 * Calls that run NIP-49's scrypt in the background (#141). A key encrypted at a high cost takes
 * many seconds to decrypt, which is not a background that has stopped answering.
 */
const SLOW_CALL_TIMEOUT_MS = 60_000;
const SLOW_CALLS: ReadonlySet<BridgeAction> = new Set<BridgeAction>([
  'accounts.exportEncrypted',
  'accounts.importEncrypted',
]);

/**
 * Calls that wait on a wallet (#142). A wallet request publishes for up to 5 s and waits up to 15 s
 * for the answer, and a connection that has not yet read its info event first waits up to 5 s for
 * that. Under the default deadline the page would report a payment as failed while the background
 * went on to make it.
 */
const WALLET_CALL_TIMEOUT_MS = 30_000;
const WALLET_CALLS: ReadonlySet<BridgeAction> = new Set<BridgeAction>([
  'nip47.getInfo',
  'nip47.getBalance',
  'nip47.payInvoice',
  'nip47.authorization.complete',
  'nip47.authorization.probe',
]);

const timeoutFor = (type: BridgeAction): number =>
  SLOW_CALLS.has(type)
    ? SLOW_CALL_TIMEOUT_MS
    : WALLET_CALLS.has(type)
      ? WALLET_CALL_TIMEOUT_MS
      : CALL_TIMEOUT_MS;
const RETRY_DELAYS_MS = [100, 400];

/**
 * Calls a timeout must not repeat: each one signs, publishes, sends or pays. A DM relay check
 * publishes a test gift wrap to every relay it checks. Importing an encrypted key adds an account:
 * a repeat would fail as a duplicate after the first had already succeeded (#141). Opening a
 * wallet authorization opens a wallet window in the background: a repeat would open another, with
 * its own client secret, for the same request (workspace#85).
 */
const NOT_REPEATED_AFTER_TIMEOUT: ReadonlySet<BridgeAction> = new Set<BridgeAction>([
  'account.signEvent',
  'accounts.importEncrypted',
  'blossom.upload',
  'messaging.dmRelays.check',
  'messaging.dmRelays.publish',
  'messaging.send',
  'nip47.authorization.open',
  'nip47.payInvoice',
  'nostr.requests.respond',
]);

const mustNotRepeat = (type: BridgeAction, error: unknown): boolean =>
  error instanceof BackgroundTimeoutError && NOT_REPEATED_AFTER_TIMEOUT.has(type);

interface BridgeEnvelope<T> {
  data: T;
}

interface BridgeLike {
  send<T>(request: {
    event: BridgeAction;
    to: 'background';
    payload?: unknown;
  }): Promise<BridgeEnvelope<T> | T | null | undefined>;
}

const getBridge = (): BridgeLike | undefined => {
  const bridgeHost = window as Window & {
    bridge?: BridgeLike;
    $q?: { bex?: BridgeLike };
  };

  return bridgeHost.bridge || bridgeHost.$q?.bex;
};

/** The background did not answer in time. It may still have received and handled the call. */
export class BackgroundTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackgroundTimeoutError';
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = <T>(operation: Promise<T>, message: string, timeoutMs: number): Promise<T> =>
  Promise.race([
    operation,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new BackgroundTimeoutError(message)), timeoutMs),
    ),
  ]);

async function attempt<T extends BridgeAction>(
  type: T,
  payload?: Omit<BridgeRequestMap[T], 'id' | 'action'>,
): Promise<BridgeResponsePayload<T> | undefined> {
  const bridge = getBridge();
  if (bridge) {
    try {
      const response = await withTimeout(
        bridge.send<BridgeResponsePayload<T>>({
          event: type,
          to: 'background',
          payload,
        }) as Promise<BridgeEnvelope<BridgeResponsePayload<T>> | BridgeResponsePayload<T>>,
        'Bridge timeout',
        timeoutFor(type),
      );
      if (response && typeof response === 'object' && 'data' in response) {
        return response.data as BridgeResponsePayload<T>;
      }
      return response ?? undefined;
    } catch (error: unknown) {
      if (mustNotRepeat(type, error)) throw error;
      logService.log(
        LogLevel.WARN,
        `[BridgeClient] Bridge call failed for ${type}, falling back to direct messaging`,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    logService.log(
      LogLevel.DEBUG,
      `[BridgeClient] Using direct chrome.runtime.sendMessage for ${type}`,
    );
    return await withTimeout(
      new Promise<BridgeResponsePayload<T> | undefined>((resolve, reject) => {
        chrome.runtime.sendMessage({ type, payload }, (response) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(response as BridgeResponsePayload<T> | undefined);
        });
      }),
      `Direct background timeout for ${type}`,
      timeoutFor(type),
    );
  }

  throw new Error('No communication channel available (bridge or chrome.runtime)');
}

export async function sendBexMessage<T extends BridgeAction>(
  type: T,
  payload?: Omit<BridgeRequestMap[T], 'id' | 'action'>,
): Promise<BridgeResponsePayload<T> | undefined> {
  let lastError: unknown;

  for (let index = 0; index <= RETRY_DELAYS_MS.length; index += 1) {
    try {
      return await attempt(type, payload);
    } catch (error: unknown) {
      if (mustNotRepeat(type, error)) throw error;
      lastError = error;
      const retryDelay = RETRY_DELAYS_MS[index];
      if (retryDelay === undefined) break;
      logService.log(LogLevel.DEBUG, `[BridgeClient] Retrying ${type} after transport failure`, {
        attempt: index + 1,
        error: error instanceof Error ? error.message : String(error),
      });
      await delay(retryDelay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
