import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';

const vault = vi.hoisted(() => ({
  unlocked: true,
  accounts: [] as { id: string; alias: string; account: { privkey: string } }[],
}));

vi.mock('@/../src-bex/handlers/vault-handler', () => ({
  handleVaultIsUnlocked: vi.fn(() => Promise.resolve({ success: true, data: vault.unlocked })),
  handleVaultGetData: vi.fn(() =>
    Promise.resolve(vault.unlocked ? { success: true, data: { vaultData: { accounts: vault.accounts } } } : { success: false, error: 'locked' }),
  ),
}));

vi.mock('@/services/log-service', () => ({ LogLevel: { INFO: 'INFO' }, logService: { log: vi.fn() } }));

import { handleAccountSignEvent } from '@/../src-bex/handlers/account-signing';
import { logService } from '@/services/log-service';

const active = generateSecretKey();
const other = generateSecretKey();
const ACTIVE = getPublicKey(active);
const OTHER = getPublicKey(other);

const template = (over: Record<string, unknown> = {}) => ({ kind: 1, content: 'hello', tags: [['t', 'porwr']], ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vault.unlocked = true;
  vault.accounts = [
    { id: ACTIVE, alias: 'main', account: { privkey: bytesToHex(active) } },
    { id: OTHER, alias: 'second', account: { privkey: bytesToHex(other) } },
  ];
});

describe('account.signEvent', () => {
  it('signs as the named account, which need not be the active one', async () => {
    const result = await handleAccountSignEvent({ accountPubkey: OTHER, template: template() });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pubkey).toBe(OTHER);
    expect(result.data.content).toBe('hello');
    expect(result.data.tags).toEqual([['t', 'porwr']]);
    expect(verifyEvent(result.data)).toBe(true);
  });

  it('signs every kind Porwr publishes: profile, contacts, relay list and QuickSign', async () => {
    for (const kind of [0, 3, 10002, 1, 30023]) {
      const result = await handleAccountSignEvent({ accountPubkey: ACTIVE, template: template({ kind }) });
      expect(result.success, `kind ${kind}`).toBe(true);
    }
  });

  it('refuses any other kind, so it is not a general signer', async () => {
    for (const kind of [4, 5, 7, 1059, 22242, 24242, 27235]) {
      const result = await handleAccountSignEvent({ accountPubkey: ACTIVE, template: template({ kind }) });
      expect(result, `kind ${kind}`).toMatchObject({ success: false });
    }
  });

  it('always signs with the account’s own pubkey, ignoring one the page sent', async () => {
    const result = await handleAccountSignEvent({
      accountPubkey: ACTIVE,
      template: { ...template(), pubkey: OTHER } as unknown as ReturnType<typeof template>,
    });

    expect(result.success && result.data.pubkey).toBe(ACTIVE);
  });

  it('keeps a created_at the page chose', async () => {
    const result = await handleAccountSignEvent({ accountPubkey: ACTIVE, template: template({ created_at: 1_700_000_000 }) });
    expect(result.success && result.data.created_at).toBe(1_700_000_000);
  });

  it('fails closed for an account not in the vault, rather than signing as another', async () => {
    await expect(
      handleAccountSignEvent({ accountPubkey: getPublicKey(generateSecretKey()), template: template() }),
    ).rejects.toThrow('Account not found');
  });

  it('finds the account by its key, not by a stored id that could be wrong', async () => {
    vault.accounts = [{ id: OTHER, alias: 'mislabelled', account: { privkey: bytesToHex(active) } }];

    await expect(handleAccountSignEvent({ accountPubkey: OTHER, template: template() })).rejects.toThrow('Account not found');
    const result = await handleAccountSignEvent({ accountPubkey: ACTIVE, template: template() });
    expect(result.success && result.data.pubkey).toBe(ACTIVE);
  });

  it('fails while the vault is locked', async () => {
    vault.unlocked = false;
    await expect(handleAccountSignEvent({ accountPubkey: ACTIVE, template: template() })).rejects.toThrow('Vault is locked');
  });

  it.each([
    ['a pubkey that is not hex', { accountPubkey: 'npub1xyz', template: template() }],
    ['no template', { accountPubkey: ACTIVE }],
    ['content that is not a string', { accountPubkey: ACTIVE, template: template({ content: 5 }) }],
    ['tags that are not string lists', { accountPubkey: ACTIVE, template: template({ tags: [['p', 5]] }) }],
    ['a created_at that is not a timestamp', { accountPubkey: ACTIVE, template: template({ created_at: -1 }) }],
  ])('refuses %s without touching the vault', async (_label, payload) => {
    const result = await handleAccountSignEvent(payload as never);
    expect(result).toMatchObject({ success: false });
  });

  it('logs the kind and the account, never the content', async () => {
    await handleAccountSignEvent({ accountPubkey: ACTIVE, template: template({ content: 'private words' }) });

    const logged = JSON.stringify(vi.mocked(logService.log).mock.calls);
    expect(logged).toContain(ACTIVE);
    expect(logged).not.toContain('private words');
  });
});
