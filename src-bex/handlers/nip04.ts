import type { HandlerResult } from '../types/background';
import { resolveSigningSigner } from '../services/signing-account';
import { INVALID_PUBKEY_MESSAGE, isHexPubkey } from '../services/pubkey';

export async function handleNip04Encrypt(
  payload: { pubkey: string; plaintext: string },
  origin: string,
): Promise<HandlerResult<string>> {
  if (!isHexPubkey(payload.pubkey)) return { success: false, error: INVALID_PUBKEY_MESSAGE };

  try {
    const signer = await resolveSigningSigner(origin);
    const ciphertext = await signer.nip04Encrypt(payload.pubkey, payload.plaintext);
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
    const signer = await resolveSigningSigner(origin);
    const plaintext = await signer.nip04Decrypt(payload.pubkey, payload.ciphertext);
    return { success: true, data: plaintext };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
