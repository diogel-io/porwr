import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  assertLnurlAmount,
  decodeLnurl,
  encodeLnurl,
  fetchLnurlPayTarget,
  lud16ToLnurlPayUrl,
  parseLnurlPayMetadata,
  requestZapInvoice,
  resolveLnurlPayUrl,
} from '@/services/nip57-lnurl';

const PUBKEY = 'a'.repeat(64);

describe('nip57-lnurl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('converts lud16 lightning addresses to LNURL-pay URLs', () => {
    expect(lud16ToLnurlPayUrl('alice@example.com')).toBe('https://example.com/.well-known/lnurlp/alice');
  });

  it('round trips bech32 LNURLs', () => {
    const url = 'https://example.com/.well-known/lnurlp/alice';
    const encoded = encodeLnurl(url);

    expect(encoded.startsWith('lnurl1')).toBe(true);
    expect(decodeLnurl(encoded)).toBe(url);
  });

  it('resolves raw URL LNURL hints by encoding them', () => {
    const resolved = resolveLnurlPayUrl({ lnurl: 'https://example.com/.well-known/lnurlp/alice' });

    expect(resolved.url).toBe('https://example.com/.well-known/lnurlp/alice');
    expect(resolved.lnurl.startsWith('lnurl1')).toBe(true);
  });

  it('parses valid NIP-57 LNURL metadata', () => {
    expect(parseLnurlPayMetadata({
      callback: 'https://wallet.example.com/callback',
      minSendable: 1000,
      maxSendable: 100000,
      allowsNostr: true,
      nostrPubkey: PUBKEY,
      commentAllowed: 280,
    })).toMatchObject({
      callback: 'https://wallet.example.com/callback',
      minSendable: 1000,
      maxSendable: 100000,
      allowsNostr: true,
      nostrPubkey: PUBKEY,
      commentAllowed: 280,
    });
  });

  it('rejects LNURL metadata without Nostr zap support', () => {
    expect(() => parseLnurlPayMetadata({
      callback: 'https://wallet.example.com/callback',
      minSendable: 1000,
      maxSendable: 100000,
      allowsNostr: false,
      nostrPubkey: PUBKEY,
    })).toThrow('does not support Nostr zaps');
  });

  it('validates requested amount against LNURL sendable bounds', () => {
    const metadata = parseLnurlPayMetadata({
      callback: 'https://wallet.example.com/callback',
      minSendable: 1000,
      maxSendable: 2000,
      allowsNostr: true,
      nostrPubkey: PUBKEY,
    });

    expect(() => assertLnurlAmount(1500, metadata)).not.toThrow();
    expect(() => assertLnurlAmount(999, metadata)).toThrow('between 1000 and 2000');
  });

  it('fetches and validates LNURL metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        callback: 'https://wallet.example.com/callback',
        minSendable: 1000,
        maxSendable: 100000,
        allowsNostr: true,
        nostrPubkey: PUBKEY,
      }),
    })));

    const result = await fetchLnurlPayTarget({ lud16: 'alice@example.com' });

    expect(result.lnurlPayUrl).toBe('https://example.com/.well-known/lnurlp/alice');
    expect(result.callback).toBe('https://wallet.example.com/callback');
  });

  it('requests a zap invoice from the LNURL callback', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => ({
      ok: true,
      json: async () => ({ pr: 'lnbc1u1pjqxyz' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestZapInvoice({
      callback: 'https://wallet.example.com/callback',
      amountMsat: 21000,
      signedZapRequest: { kind: 9734, id: 'zap-id' },
      lnurl: 'lnurl1abc',
    });

    expect(result.invoice).toBe('lnbc1u1pjqxyz');
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const calledUrl = new URL(String(firstCall?.[0]));
    expect(calledUrl.searchParams.get('amount')).toBe('21000');
    expect(calledUrl.searchParams.get('lnurl')).toBe('lnurl1abc');
    expect(calledUrl.searchParams.get('nostr')).toContain('9734');
  });
});
