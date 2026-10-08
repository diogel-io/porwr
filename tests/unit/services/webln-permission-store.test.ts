import { describe, expect, it, vi } from 'vitest';

import {
  hasWebLnPermission,
  listWebLnPermissions,
  upsertWebLnPermission,
} from '@/../src-bex/services/webln-permission-store';
import type { VaultData } from '@/types/bridge';

describe('webln-permission-store', () => {
  it('lists empty permissions for vaults without WebLN grants', () => {
    expect(listWebLnPermissions({ accounts: [] })).toEqual([]);
  });

  it('adds and checks an origin-scoped WebLN permission grant', () => {
    const vaultData: VaultData = { accounts: [] };
    const updated = upsertWebLnPermission(vaultData, {
      origin: 'https://jumble.social',
      connectionId: 'wallet-a',
      methods: ['enable', 'getInfo'],
      createdAt: '2026-06-23T00:00:00.000Z',
    });

    expect(hasWebLnPermission(updated, {
      origin: 'https://jumble.social',
      connectionId: 'wallet-a',
      method: 'getInfo',
    })).toBe(true);
    expect(hasWebLnPermission(updated, {
      origin: 'https://other.example',
      connectionId: 'wallet-a',
      method: 'getInfo',
    })).toBe(false);
  });

  it('rejects expired WebLN grants', () => {
    vi.setSystemTime(new Date('2026-06-23T12:00:00.000Z'));
    const vaultData = upsertWebLnPermission({ accounts: [] }, {
      origin: 'https://jumble.social',
      connectionId: 'wallet-a',
      methods: ['enable'],
      createdAt: '2026-06-23T00:00:00.000Z',
      expiresAt: '2026-06-23T11:00:00.000Z',
    });

    expect(hasWebLnPermission(vaultData, {
      origin: 'https://jumble.social',
      connectionId: 'wallet-a',
      method: 'enable',
    })).toBe(false);
    vi.useRealTimers();
  });
});
