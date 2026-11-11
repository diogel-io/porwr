import type { StoredKey } from '@/types';
import type { HandlerResult } from '../types/background';
import { signingSignerFor } from '../services/signing-account';
import { isVaultUnlocked } from '../vault';
import { INVALID_PUBKEY_MESSAGE, isHexPubkey } from '../services/pubkey';

/**
 * NIP-44 encrypt to `payload.pubkey` as `account`, the account the request was approved as
 * (diogel-io/workspace#227). Refuses a malformed counterparty or a locked vault.
 */
export async function handleNip44Encrypt(
  payload: { pubkey: string; plaintext: string },
  origin: string,
  account: StoredKey,
): Promise<HandlerResult<string>> {
  if (!isHexPubkey(payload.pubkey)) return { success: false, error: INVALID_PUBKEY_MESSAGE };
  if (!isVaultUnlocked()) return { success: false, error: 'Vault is locked' };

  try {
    const signer = signingSignerFor(account, origin);
    const ciphertext = await signer.nip44Encrypt(payload.pubkey, payload.plaintext);

    return { success: true, data: ciphertext };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * NIP-44 decrypt a message from `payload.pubkey` as `account`, the account the request was approved
 * as (diogel-io/workspace#227). Refuses a malformed counterparty or a locked vault.
 */
export async function handleNip44Decrypt(
  payload: { pubkey: string; ciphertext: string },
  origin: string,
  account: StoredKey,
): Promise<HandlerResult<string>> {
  if (!isHexPubkey(payload.pubkey)) return { success: false, error: INVALID_PUBKEY_MESSAGE };
  if (!isVaultUnlocked()) return { success: false, error: 'Vault is locked' };

  try {
    const signer = signingSignerFor(account, origin);
    const plaintext = await signer.nip44Decrypt(payload.pubkey, payload.ciphertext);

    return { success: true, data: plaintext };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
