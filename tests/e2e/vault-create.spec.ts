import { expect, test } from './fixtures/extension';
import { createVault, seedAccount } from './fixtures/vault';

/**
 * A vault created through the UI holds no placeholder mnemonic or passphrase (#244).
 *
 * The page sends only the password and the background builds the vault. Checked in the background
 * itself: it decrypts the stored vault with the unlocked session key (#245), which is what Porwr
 * does on every read, and inspects what is really there.
 */

/** The decrypted vault, read in the service worker. Layout: v2:base64(version, salt[32], iv[12], ciphertext). */
const decryptedVault = (background: Parameters<Parameters<typeof test>[2]>[0]['background']) =>
  background.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const open = indexedDB.open('DiogelDatabase');
        open.onerror = () => reject(open.error ?? new Error('open failed'));
        open.onsuccess = () => {
          const tx = open.result.transaction(['vaults', 'vaultSession']);
          const vault = tx.objectStore('vaults').get('master');
          const session = tx.objectStore('vaultSession').get('current');
          tx.onerror = () => reject(tx.error ?? new Error('read failed'));
          tx.oncomplete = () => {
            open.result.close();
            const encrypted = (vault.result as { encryptedData: string }).encryptedData;
            const bytes = Uint8Array.from(atob(encrypted.slice(3)), (c) => c.charCodeAt(0));
            const { key } = session.result as { key: CryptoKey };
            crypto.subtle
              .decrypt({ name: 'AES-GCM', iv: bytes.slice(33, 45) }, key, bytes.slice(45))
              .then((plain) =>
                resolve(JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>),
              )
              .catch(reject);
          };
        };
      }),
  );

test('a vault created through the UI holds no mnemonic or passphrase (#244)', async ({
  openPage,
  background,
}) => {
  const page = await openPage('/login');
  await createVault(page);

  const created = await decryptedVault(background);
  expect(created).toEqual({ accounts: [], createdAt: expect.any(String) });

  // Still none after the vault is written again, here by adding an account.
  await seedAccount(page);
  const written = await decryptedVault(background);
  expect(written).not.toHaveProperty('mnemonic');
  expect(written).not.toHaveProperty('passphrase');
  expect((written.accounts as unknown[]).length).toBe(1);
});
