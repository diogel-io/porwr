import { finalizeEvent, verifyEvent } from 'nostr-tools';
import type { Event } from 'nostr-tools';

import { LogLevel, logService } from '@/services/log-service';
import { ACCOUNT_SIGNABLE_KINDS, type AccountSignRequest } from '@/types/account-signing';
import { createPubkey } from '@/types/pubkey';
import type { HandlerResult } from '../types/background';
import { getSecretKeyForAccount } from './active-key';

/**
 * Signs an event as one of the vault's accounts, for Porwr's own pages (#240).
 *
 * Replaces the pages signing with a private key they held themselves. The key stays here; the page
 * gets the signed event, which is public anyway, and publishes it.
 *
 * Narrow on purpose: only the kinds Porwr's own features publish, only an account in the vault, and
 * the event's `pubkey` is always the account's, whatever the page sent. The raw listener only accepts
 * this from extension pages, so a website cannot reach it.
 */

const isStringMatrix = (value: unknown): value is string[][] =>
  Array.isArray(value) && value.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'));

export async function handleAccountSignEvent(payload: AccountSignRequest): Promise<HandlerResult<Event>> {
  const pubkey = createPubkey(typeof payload?.accountPubkey === 'string' ? payload.accountPubkey : '');
  if (!pubkey) {
    return { success: false, error: 'accountPubkey must be a hex public key' };
  }

  const template = payload.template;
  if (!template || typeof template !== 'object') {
    return { success: false, error: 'A template is required' };
  }
  if (typeof template.kind !== 'number' || !ACCOUNT_SIGNABLE_KINDS.includes(template.kind)) {
    return { success: false, error: `Kind ${String(template.kind)} cannot be signed here` };
  }
  if (typeof template.content !== 'string') {
    return { success: false, error: 'content must be a string' };
  }
  if (!isStringMatrix(template.tags)) {
    return { success: false, error: 'tags must be a list of string lists' };
  }
  if (template.created_at !== undefined && (!Number.isInteger(template.created_at) || template.created_at < 0)) {
    return { success: false, error: 'created_at must be a timestamp' };
  }

  const secretKey = await getSecretKeyForAccount(pubkey);
  const signed = finalizeEvent(
    {
      kind: template.kind,
      content: template.content,
      tags: template.tags,
      created_at: template.created_at ?? Math.floor(Date.now() / 1000),
    },
    secretKey,
  );
  if (!verifyEvent(signed)) {
    return { success: false, error: 'Signed event failed verification' };
  }

  // The kind and who signed it, never the content.
  logService.log(LogLevel.INFO, '[AccountSigning] Signed an event for an extension page', {
    kind: signed.kind,
    account: pubkey,
  });
  return { success: true, data: signed };
}
