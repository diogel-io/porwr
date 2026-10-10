import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('@/services/vault-service', () => ({ sendBexMessage: send }));

import { signAsAccount } from '@/services/account-signing-client';

const PUBKEY = 'a'.repeat(64);
const template = { kind: 3, content: '', tags: [['p', 'b'.repeat(64)]] };

beforeEach(() => send.mockReset());

describe('signAsAccount', () => {
  it('asks the background to sign as the account and returns the signed event', async () => {
    const signed = { ...template, id: 'e', pubkey: PUBKEY, created_at: 1, sig: 's' };
    send.mockResolvedValue(signed);

    await expect(signAsAccount(PUBKEY, template)).resolves.toEqual(signed);
    expect(send).toHaveBeenCalledWith('account.signEvent', { accountPubkey: PUBKEY, template });
  });

  it('turns a refusal into an error', async () => {
    send.mockResolvedValue({ success: false, error: 'Account not found' });
    await expect(signAsAccount(PUBKEY, template)).rejects.toThrow('Account not found');
  });

  it('rejects an answer that is not a signed event, or is signed by someone else', async () => {
    send.mockResolvedValue(undefined);
    await expect(signAsAccount(PUBKEY, template)).rejects.toThrow('Invalid signing response');

    send.mockResolvedValue({ ...template, id: 'e', pubkey: 'c'.repeat(64), created_at: 1, sig: 's' });
    await expect(signAsAccount(PUBKEY, template)).rejects.toThrow('Invalid signing response');
  });
});
