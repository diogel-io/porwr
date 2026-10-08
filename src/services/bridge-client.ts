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
 */

const CALL_TIMEOUT_MS = 5000;
const RETRY_DELAYS_MS = [100, 400];

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

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = <T>(operation: Promise<T>, message: string): Promise<T> =>
  Promise.race([
    operation,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), CALL_TIMEOUT_MS)),
  ]);

async function attempt<T extends BridgeAction>(
  type: T,
  payload?: Omit<BridgeRequestMap[T], 'id' | 'action'>,
): Promise<BridgeResponsePayload<T> | undefined> {
  const bridge = getBridge();
  if (bridge) {
    try {
      const response = await withTimeout(
        bridge.send<BridgeResponsePayload<T>>({ event: type, to: 'background', payload }) as Promise<
          BridgeEnvelope<BridgeResponsePayload<T>> | BridgeResponsePayload<T>
        >,
        'Bridge timeout',
      );
      if (response && typeof response === 'object' && 'data' in response) {
        return response.data as BridgeResponsePayload<T>;
      }
      return response ?? undefined;
    } catch (error: unknown) {
      logService.log(
        LogLevel.WARN,
        `[BridgeClient] Bridge call failed for ${type}, falling back to direct messaging`,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    logService.log(LogLevel.DEBUG, `[BridgeClient] Using direct chrome.runtime.sendMessage for ${type}`);
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
