import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  signAsAccount: vi.fn(),
  relays: ['wss://relay-a.example', 'wss://relay-b.example'],
}));

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>();
  return {
    ...actual,
    SimplePool: class {
      publish = mocks.publish;
      querySync = vi.fn(() => Promise.resolve([]));
    },
  };
});
vi.mock('@/stores/settings-store', () => ({
  default: () => ({ getFallbackRelays: vi.fn(() => Promise.resolve(mocks.relays)) }),
}));
vi.mock('@/services/account-signing-client', () => ({ signAsAccount: mocks.signAsAccount }));

import { publishContactList } from '@/services/contact-list-service';

const ACCOUNT = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signAsAccount.mockImplementation((pubkey: string, template: object) =>
    Promise.resolve({ ...template, id: 'e'.repeat(64), pubkey, sig: 's'.repeat(128) }),
  );
  mocks.publish.mockImplementation((relays: string[]) => relays.map(() => Promise.resolve('ok')));
});

describe('contact list (#240)', () => {
  it('has the background sign the kind 3 as the account, then publishes it', async () => {
    const result = await publishContactList(ACCOUNT, [
      { pubkey: BOB, relayUrl: '', petname: 'Bob' },
    ]);

    expect(mocks.signAsAccount).toHaveBeenCalledWith(
      ACCOUNT,
      expect.objectContaining({ kind: 3, content: '', tags: [['p', BOB, '', 'Bob']] }),
    );
    expect(mocks.publish).toHaveBeenCalledWith(
      mocks.relays,
      expect.objectContaining({ kind: 3, pubkey: ACCOUNT }),
    );
    expect(result.relayResults.every((relay) => relay.success)).toBe(true);
  });

  it('does not publish when the background refuses to sign', async () => {
    mocks.signAsAccount.mockRejectedValue(new Error('Vault is locked'));

    await expect(publishContactList(ACCOUNT, [])).rejects.toThrow('Vault is locked');
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
