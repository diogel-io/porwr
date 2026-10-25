import { nip04 } from 'nostr-tools';
import type { HandlerResult } from '../types/background';
import { resolveSigningSecretKey } from '../services/signing-account';
import { INVALID_PUBKEY_MESSAGE, isHexPubkey } from '../services/pubkey';

export async function handleNip04Encrypt(
  payload: { pubkey: string; plaintext: string },
  origin: string,
): Promise<HandlerResult<string>> {
  if (!isHexPubkey(payload.pubkey)) return { success: false, error: INVALID_PUBKEY_MESSAGE };

  try {
    const secretKey = await resolveSigningSecretKey(origin);
    const ciphertext = nip04.encrypt(secretKey, payload.pubkey, payload.plaintext);
    return { success: true, data: ciphertext };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function handleNip04Decrypt(
  payload: { pubkey: string; ciphertext: string },
  origin: string,
): Promise<HandlerResult<string>> {
  if (!isHexPubkey(payload.pubkey)) return { success: false, error: INVALID_PUBKEY_MESSAGE };

  try {
    const secretKey = await resolveSigningSecretKey(origin);
    const plaintext = nip04.decrypt(secretKey, payload.pubkey, payload.ciphertext);
    return { success: true, data: plaintext };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
