import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import { clearLegacyExceptions } from '@/services/database';

/**
 * Earlier builds persisted raw error text in `exceptions`, which could carry plaintext or event
 * content. New failures no longer keep it (#144, threat model T11), and the rows an upgraded
 * profile already holds are removed once by the version 12 upgrade.
 */
describe('the version 12 upgrade', () => {
  it('deletes every exception row an earlier build wrote', async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    const table = vi.fn(() => ({ clear }));

    await clearLegacyExceptions({ table } as never);

    expect(table).toHaveBeenCalledWith('exceptions');
    expect(clear).toHaveBeenCalledTimes(1);
  });

  // Dexie cannot run here (no IndexedDB), so this reads the schema declaration instead.
  it('is the upgrade attached to version 12', () => {
    const source = readFileSync(resolve(__dirname, '../../../src/services/database.ts'), 'utf8');

    expect(source).toMatch(/this\.version\(12\)[\s\S]*?\.upgrade\(clearLegacyExceptions\)/);
  });
});
