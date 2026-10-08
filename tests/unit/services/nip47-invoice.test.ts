import { describe, expect, it } from 'vitest';

import { parseBolt11AmountMsat, previewInvoice } from '@/services/nip47-invoice';

describe('parseBolt11AmountMsat', () => {
  it('parses milli-bitcoin amounts', () => {
    expect(parseBolt11AmountMsat('lnbc1m1pjqxyz')).toBe(100_000_000);
  });

  it('parses micro-bitcoin amounts', () => {
    expect(parseBolt11AmountMsat('lnbc1u1pjqxyz')).toBe(100_000);
  });

  it('parses nano-bitcoin amounts', () => {
    expect(parseBolt11AmountMsat('lnbc1n1pjqxyz')).toBe(100);
  });

  it('parses pico-bitcoin amounts', () => {
    expect(parseBolt11AmountMsat('lnbc10p1pjqxyz')).toBe(1);
  });

  it('parses unsuffixed amounts as whole bitcoin', () => {
    expect(parseBolt11AmountMsat('lnbc11pjqxyz')).toBe(100_000_000_000);
  });

  it('supports testnet and regtest prefixes', () => {
    expect(parseBolt11AmountMsat('lntb1m1pjqxyz')).toBe(100_000_000);
    expect(parseBolt11AmountMsat('lnbcrt1m1pjqxyz')).toBe(100_000_000);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(parseBolt11AmountMsat('  LNBC1M1PJQXYZ  ')).toBe(100_000_000);
  });

  it('returns undefined when no amount is encoded', () => {
    expect(parseBolt11AmountMsat('lnbc1pjqxyz')).toBeUndefined();
  });

  it('returns undefined for invoices that do not match the BOLT11 pattern', () => {
    expect(parseBolt11AmountMsat('not-an-invoice')).toBeUndefined();
    expect(parseBolt11AmountMsat('')).toBeUndefined();
  });
});

describe('previewInvoice', () => {
  it('returns short invoices unchanged', () => {
    expect(previewInvoice('lnbc1pjqxyz')).toBe('lnbc1pjqxyz');
  });

  it('trims surrounding whitespace before checking length', () => {
    expect(previewInvoice('  lnbc1pjqxyz  ')).toBe('lnbc1pjqxyz');
  });

  it('truncates long invoices, keeping the prefix and suffix', () => {
    const invoice = `lnbc1${'a'.repeat(60)}xyz`;
    const result = previewInvoice(invoice);

    expect(result).toBe(`${invoice.slice(0, 24)}…${invoice.slice(-12)}`);
    expect(result.length).toBe(24 + 1 + 12);
  });
});
