import { bech32 } from '@scure/base';
import type { LnurlInvoiceResponse, LnurlPayMetadata, ResolvedLnurlPayTarget } from '@/types/nip57';

const HEX_PUBKEY_PATTERN = /^[0-9a-fA-F]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireSafeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`LNURL response contains invalid ${field}`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`LNURL response contains invalid ${field}`);
  }
  return value.trim();
}

export function isValidNostrPubkey(value: string): boolean {
  return HEX_PUBKEY_PATTERN.test(value);
}

export function encodeLnurl(url: string): string {
  return bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), false);
}

export function decodeLnurl(lnurl: string): string {
  const decoded = bech32.decode(lnurl.toLowerCase() as `${string}1${string}`, 2000);
  if (decoded.prefix !== 'lnurl') {
    throw new Error('Invalid LNURL prefix');
  }
  return new TextDecoder().decode(Uint8Array.from(bech32.fromWords(decoded.words)));
}

export function lud16ToLnurlPayUrl(lud16: string): string {
  const trimmed = lud16.trim();
  const [name, domain, ...rest] = trimmed.split('@');
  if (!name || !domain || rest.length > 0) {
    throw new Error('Invalid lightning address');
  }
  return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
}

export function resolveLnurlPayUrl(input: { lnurl?: string; lud16?: string }): { url: string; lnurl: string } {
  if (input.lnurl?.trim()) {
    const value = input.lnurl.trim();
    const url = value.toLowerCase().startsWith('lnurl') ? decodeLnurl(value) : value;
    return { url, lnurl: value.toLowerCase().startsWith('lnurl') ? value : encodeLnurl(url) };
  }
  if (input.lud16?.trim()) {
    const url = lud16ToLnurlPayUrl(input.lud16);
    return { url, lnurl: encodeLnurl(url) };
  }
  throw new Error('LNURL or lightning address is required');
}

function assertHttpsUrl(value: string, field: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error(`${field} must use HTTPS`);
  }
}

export function parseLnurlPayMetadata(value: unknown): LnurlPayMetadata {
  if (!isRecord(value)) {
    throw new Error('LNURL response was not an object');
  }
  const callback = requireString(value.callback, 'callback');
  assertHttpsUrl(callback, 'LNURL callback');
  const minSendable = requireSafeInteger(value.minSendable, 'minSendable');
  const maxSendable = requireSafeInteger(value.maxSendable, 'maxSendable');
  if (maxSendable < minSendable) {
    throw new Error('LNURL maxSendable is lower than minSendable');
  }
  if (value.allowsNostr !== true) {
    throw new Error('LNURL endpoint does not support Nostr zaps');
  }
  const nostrPubkey = requireString(value.nostrPubkey, 'nostrPubkey');
  if (!isValidNostrPubkey(nostrPubkey)) {
    throw new Error('LNURL nostrPubkey is invalid');
  }
  return {
    callback,
    minSendable,
    maxSendable,
    allowsNostr: true,
    nostrPubkey,
    ...(typeof value.metadata === 'string' ? { metadata: value.metadata } : {}),
    ...(typeof value.commentAllowed === 'number' && Number.isSafeInteger(value.commentAllowed)
      ? { commentAllowed: value.commentAllowed }
      : {}),
  };
}

export async function fetchLnurlPayTarget(input: { lnurl?: string; lud16?: string }): Promise<ResolvedLnurlPayTarget> {
  const resolved = resolveLnurlPayUrl(input);
  assertHttpsUrl(resolved.url, 'LNURL pay URL');
  const response = await fetch(resolved.url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`LNURL metadata request failed with HTTP ${response.status}`);
  }
  const metadata = parseLnurlPayMetadata(await response.json());
  return {
    ...metadata,
    lnurl: resolved.lnurl,
    lnurlPayUrl: resolved.url,
  };
}

export function assertLnurlAmount(amountMsat: number, metadata: LnurlPayMetadata): void {
  if (!Number.isSafeInteger(amountMsat) || amountMsat <= 0) {
    throw new Error('Zap amount must be a positive integer millisat value');
  }
  if (amountMsat < metadata.minSendable || amountMsat > metadata.maxSendable) {
    throw new Error(`Zap amount must be between ${metadata.minSendable} and ${metadata.maxSendable} msat`);
  }
}

export async function requestZapInvoice(input: {
  callback: string;
  amountMsat: number;
  signedZapRequest: unknown;
  lnurl: string;
}): Promise<LnurlInvoiceResponse> {
  const url = new URL(input.callback);
  url.searchParams.set('amount', String(input.amountMsat));
  url.searchParams.set('nostr', JSON.stringify(input.signedZapRequest));
  url.searchParams.set('lnurl', input.lnurl);
  const response = await fetch(url.toString(), { method: 'GET' });
  if (!response.ok) {
    throw new Error(`LNURL callback failed with HTTP ${response.status}`);
  }
  const parsed = await response.json() as unknown;
  if (!isRecord(parsed)) {
    throw new Error('LNURL callback response was not an object');
  }
  const pr = parsed.pr;
  if (typeof pr !== 'string' || pr.trim().length === 0) {
    throw new Error('LNURL callback did not return a BOLT11 invoice');
  }
  return {
    invoice: pr.trim(),
    ...(Array.isArray(parsed.routes) ? { routes: parsed.routes } : {}),
  };
}
