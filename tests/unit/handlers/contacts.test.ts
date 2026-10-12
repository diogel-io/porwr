import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveStoredKey: vi.fn(),
  refreshContactsInBackground: vi.fn(),
}));

vi.mock('@/../src-bex/handlers/active-key', () => ({ getActiveStoredKey: mocks.getActiveStoredKey }));
vi.mock('@/../src-bex/services/contact-cache-refresher', () => ({
  refreshContactsInBackground: mocks.refreshContactsInBackground,
}));

import { handleContactsRefresh, refreshActiveAccountContacts } from '@/../src-bex/handlers/contacts';

const ALICE = 'a'.repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveStoredKey.mockResolvedValue({ id: ALICE, alias: 'alice', account: { privkey: '' }, createdAt: '' });
});

describe('contacts.refresh (#257)', () => {
  it('queues a refresh for the active account and answers at once', async () => {
    await expect(handleContactsRefresh({})).resolves.toEqual({ success: true, data: { accountPubkey: ALICE } });

    expect(mocks.refreshContactsInBackground).toHaveBeenCalledWith(ALICE, { force: false });
  });

  it('passes on a forced refresh', async () => {
    await handleContactsRefresh({ force: true });

    expect(mocks.refreshContactsInBackground).toHaveBeenCalledWith(ALICE, { force: true });
  });

  it('refuses while the vault is locked', async () => {
    mocks.getActiveStoredKey.mockRejectedValue(new Error('Vault is locked'));

    await expect(handleContactsRefresh({})).rejects.toThrow('Vault is locked');
    expect(mocks.refreshContactsInBackground).not.toHaveBeenCalled();
  });
});

describe('refreshActiveAccountContacts', () => {
  it('refreshes the active account', async () => {
    await refreshActiveAccountContacts();

    expect(mocks.refreshContactsInBackground).toHaveBeenCalledWith(ALICE);
  });

  it('does nothing, quietly, while locked', async () => {
    mocks.getActiveStoredKey.mockRejectedValue(new Error('Vault is locked'));

    await expect(refreshActiveAccountContacts()).resolves.toBeUndefined();
    expect(mocks.refreshContactsInBackground).not.toHaveBeenCalled();
  });
});
