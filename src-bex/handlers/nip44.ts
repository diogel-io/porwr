import { nip44 } from 'nostr-tools';
import type { HandlerResult } from '../types/background';
import { resolveSigningSecretKey } from '../services/signing-account';

export async function handleNip44Encrypt(
  payload: { pubkey: string; plaintext: string },
  origin: string,
): Promise<HandlerResult<string>> {
  try {
    const secretKey = await resolveSigningSecretKey(origin);
    const conversationKey = nip44.getConversationKey(secretKey, payload.pubkey);
    const ciphertext = nip44.encrypt(payload.plaintext, conversationKey);

    return { success: true, data: ciphertext };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function handleNip44Decrypt(
  payload: { pubkey: string; ciphertext: string },
  origin: string,
): Promise<HandlerResult<string>> {
  try {
    const secretKey = await resolveSigningSecretKey(origin);
    const conversationKey = nip44.getConversationKey(secretKey, payload.pubkey);
    const plaintext = nip44.decrypt(payload.ciphertext, conversationKey);

    return { success: true, data: plaintext };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
