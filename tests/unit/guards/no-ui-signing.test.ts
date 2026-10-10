import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * Extension pages do not sign with, or read, a private key (#240).
 *
 * Signing happens in the background (`account.signEvent`); a page gets the signed event. A page that
 * calls `finalizeEvent` or reads `account.privkey` is holding key material it should not have.
 *
 * Revealing or exporting a key goes through `accounts.revealSecret`, which hands over one nsec; nothing
 * in a page reads `account.privkey`. The only exception:
 */
const ALLOWED: Record<string, string> = {
  // Lives under src/ but is only ever called by src-bex/handlers/nip57.ts, in the background.
  'src/services/nip57-zap-request.ts': 'background-only',
};

/**
 * `StoredKey` and `VaultData` carry private keys, mnemonics and wallet secrets. Pages use
 * `AccountSummary` and `VaultView` instead. The exceptions only ever send a new vault *in*:
 */
const MAY_NAME_VAULT_TYPES: Record<string, string> = {
  // `vault.create` sends the new vault, with its mnemonic, to the background. Generating the mnemonic
  // in the background instead is a follow-up to #240.
  'src/services/vault-service.ts': 'vault.create payload',
  'src/stores/vault-store.ts': 'vault.create payload',
};

const ROOT = resolve(__dirname, '../../..');
const SRC = join(ROOT, 'src');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|vue)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });

describe('extension pages never hold a private key', () => {
  const files = sourceFiles(SRC).map((path) => ({ path: relative(ROOT, path), source: readFileSync(path, 'utf8') }));

  it('scans the UI source', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('only the allowed files call finalizeEvent or read account.privkey', () => {
    const offenders = files
      .filter(({ source }) => /\bfinalizeEvent\b|account\.privkey/.test(source))
      .map(({ path }) => path)
      .filter((path) => !(path in ALLOWED));

    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist honest', () => {
    // An entry that no longer needs the exception should be removed, not left to excuse a new one.
    for (const path of Object.keys(ALLOWED)) {
      const file = files.find((entry) => entry.path === path);
      expect(file, `${path} no longer exists`).toBeDefined();
      expect(/\bfinalizeEvent\b|account\.privkey/.test(file!.source), `${path} no longer needs the exception`).toBe(true);
    }
  });

  it('has only the background call the zap-request signer', () => {
    const callers = files.filter(({ path, source }) => path !== 'src/services/nip57-zap-request.ts' && /nip57-zap-request/.test(source));
    expect(callers.map(({ path }) => path)).toEqual([]);
  });

  it('keeps the background-only vault types out of pages (#240)', () => {
    const offenders = files
      .filter(({ path }) => !path.startsWith('src/types/'))
      .filter(({ source }) => /import type \{[^}]*\b(StoredKey|VaultData)\b[^}]*\}/s.test(source))
      .map(({ path }) => path)
      .filter((path) => !(path in MAY_NAME_VAULT_TYPES));

    expect(offenders).toEqual([]);
  });
});
