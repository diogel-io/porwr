/**
 * NIP-07 method handlers
 */

import type { StoredKey } from '@/types';
import type { HandlerResult, UnsignedEvent, SignedEvent } from '../types/background';
import { isVaultUnlocked } from '../vault';
import { checkPermission } from './permission-handler';
import { signerFor } from '../services/account-signer';
import {
  Nip46BadResponseError,
  Nip46RefusedError,
  Nip46TimeoutError,
} from '../services/nip46-client';
import { RemoteAccountUnsupportedError } from '../services/account-key';
import { messagingRelays, type Nip07RelayMap } from '../services/messaging-relays';
import { logService } from '@/services/log-service';
import { ErrorCode } from '@/types/error-codes.d';

const logWrapper = <TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  name: string,
) => logService.wrapWithLogging(fn, 'Nip07Handler', name);

/** The code for a failed signature, telling a remote signer's refusal or silence apart (#138). */
const signingErrorCode = (error: unknown): ErrorCode =>
  error instanceof Nip46TimeoutError
    ? ErrorCode.SIG_REMOTE_TIMEOUT
    : error instanceof Nip46RefusedError
      ? ErrorCode.SIG_REMOTE_REFUSED
      : error instanceof Nip46BadResponseError
        ? ErrorCode.SIG_REMOTE_BAD_RESPONSE
        : error instanceof RemoteAccountUnsupportedError
          ? ErrorCode.SIG_REMOTE_UNSUPPORTED
          : ErrorCode.SIG_FAILED;

export const handleGetPublicKey = logWrapper(
  (_payload: unknown, origin: string, account: StoredKey): Promise<HandlerResult<string>> => {
    void _payload;
    void origin;
    if (!isVaultUnlocked()) {
      return Promise.resolve({
        success: false,
        error: 'Vault is locked',
        code: ErrorCode.VLT_LOCKED,
      });
    }

    // This is where a site's identity is established, and the answer a client will cache: the
    // account the user approved, passed in rather than resolved again (diogel-io/workspace#227).
    return Promise.resolve({ success: true, data: account.id });
  },
  'getPublicKey',
);

/**
 * The relays the site's account publishes in its kind 10002, never the active account's (#116).
 * Clients put these in the `relays` tag of a zap request, so an empty answer leaves zap receipts
 * with nowhere to go (#270).
 */
export const handleGetRelays = logWrapper(
  async (
    _payload: unknown,
    origin: string,
    account: StoredKey,
  ): Promise<HandlerResult<Nip07RelayMap>> => {
    void _payload;
    void origin;
    if (!isVaultUnlocked()) {
      return { success: false, error: 'Vault is locked', code: ErrorCode.VLT_LOCKED };
    }

    return { success: true, data: await messagingRelays.loadRelayMap(account.id) };
  },
  'getRelays',
);

export const handleSignEvent = logWrapper(
  async (
    payload: { event: UnsignedEvent },
    origin: string,
    account: StoredKey,
    options: { skipPermissionCheck?: boolean } = {},
  ): Promise<HandlerResult<SignedEvent>> => {
    // Check vault
    if (!isVaultUnlocked()) {
      return { success: false, error: 'Vault is locked', code: ErrorCode.VLT_LOCKED };
    }

    // The account the request was approved as, or the one an earlier grant belongs to, never the
    // active one, so a signature comes from the identity the user saw (#116,
    // diogel-io/workspace#227). The permission check, when there is one, is against this account.

    // Check permission
    if (!options.skipPermissionCheck) {
      // In signing's own key space, and against this account: a grant given to another identity, or
      // by a request carrying no event kind, cannot answer it (#116, #136).
      const permission = await checkPermission(
        origin,
        account.id,
        'sign_event',
        payload.event.kind,
      );
      if (!permission.granted) {
        return { success: false, error: 'Permission denied', code: ErrorCode.PER_DENIED };
      }
    }

    try {
      // With the vault's key, or by the account's remote signer, which may refuse on its own and
      // whose answer is checked against this event before it is returned (#138).
      payload.event.pubkey = account.id;
      const signed = await signerFor(account, { origin }).signEvent(payload.event);

      return { success: true, data: signed };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to sign event';
      return { success: false, error: message, code: signingErrorCode(error) };
    }
  },
  'signEvent',
);
