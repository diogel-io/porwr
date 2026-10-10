import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nip19, generateSecretKey, getPublicKey } from 'nostr-tools';
import { Blob as NodeBlob } from 'node:buffer';
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import type { AccountSummary } from '@/types/accounts';
import { createEncryptedZipBytes, formatKeyBackupText } from '@/services/compressor';
import generateKeyExportText from '@/services/compressor';

// jsdom's Blob polyfill in this test environment doesn't implement
// arrayBuffer(), which @zip.js/zip.js relies on internally. Swap in Node's
// spec-compliant Blob for this file only so the zip round-trip is exercised
// against real behavior instead of a weaker signature-only check.
const jsdomBlob = globalThis.Blob;
beforeAll(() => {
  globalThis.Blob = NodeBlob as unknown as typeof Blob;
});
afterAll(() => {
  globalThis.Blob = jsdomBlob;
});

/** An account summary and its nsec, as the background's reveal would hand them over (#240). */
function buildKey(overrides: Partial<AccountSummary> = {}): { key: AccountSummary; nsec: string } {
  const sk = generateSecretKey();
  return {
    key: { id: getPublicKey(sk), alias: 'alpha', createdAt: '2026-01-01T00:00:00.000Z', ...overrides },
    nsec: nip19.nsecEncode(sk),
  };
}

describe('generateKeyExportText (default export)', () => {
  it('throws when given no key', () => {
    expect(() => generateKeyExportText(undefined as unknown as AccountSummary, '')).toThrow(
      'Stored key cannot be null or undefined',
    );
  });

  it('writes the npub and the revealed nsec into the backup text', () => {
    const { key, nsec } = buildKey();

    const text = generateKeyExportText(key, nsec);

    expect(text).toContain(`Alias: ${key.alias}`);
    expect(text).toContain(nip19.npubEncode(key.id));
    expect(text).toContain(`nsec (Private Key): ${nsec}`);
    expect(text).not.toContain('Error');
  });

  it('reports an npub encoding error when the id is not valid hex', () => {
    const { key, nsec } = buildKey({ id: 'not-hex' });

    const text = generateKeyExportText(key, nsec);

    expect(text).toContain('npub (Public Key):  Error (Invalid ID)');
  });

  it('reports an nsec error when the reveal gave back something that is not an nsec', () => {
    const { key } = buildKey();

    const text = generateKeyExportText(key, 'not-an-nsec');

    expect(text).toContain('nsec (Private Key): Error (Invalid Private Key)');
  });
});

describe('formatKeyBackupText', () => {
  it('includes every field in the formatted backup', () => {
    const text = formatKeyBackupText('alpha', '2026-01-01T00:00:00.000Z', 'npub1abc', 'nsec1xyz');

    expect(text).toContain('Alias: alpha');
    expect(text).toContain('Created At: 2026-01-01T00:00:00.000Z');
    expect(text).toContain('npub (Public Key):  npub1abc');
    expect(text).toContain('nsec (Private Key): nsec1xyz');
    expect(text).toContain('DIOGEL KEY BACKUP');
  });
});

describe('createEncryptedZipBytes', () => {
  it('produces a password-protected zip containing the key backup text', async () => {
    const { key, nsec } = buildKey();

    const bytes = await createEncryptedZipBytes('correct horse battery staple', 'export.zip', key, nsec);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const reader = new ZipReader(new BlobReader(new Blob([bytes])), {
      password: 'correct horse battery staple',
    });
    const entries = await reader.getEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry?.filename).toBe(`${key.alias}.txt`);
    if (!entry || entry.directory) {
      throw new Error('expected a file entry');
    }

    const content = await entry.getData(new TextWriter());
    expect(content).toContain(nip19.npubEncode(key.id));
    expect(content).toContain(`Alias: ${key.alias}`);
    await reader.close();
  });

  it('rejects a wrong password when reading the archive back', async () => {
    const { key, nsec } = buildKey();
    const bytes = await createEncryptedZipBytes('correct-password', 'export.zip', key, nsec);

    const reader = new ZipReader(new BlobReader(new Blob([bytes])), { password: 'wrong-password' });
    const entries = await reader.getEntries();
    const entry = entries[0];
    if (!entry || entry.directory) {
      throw new Error('expected a file entry');
    }

    await expect(entry.getData(new TextWriter())).rejects.toThrow();
    await reader.close();
  });
});
