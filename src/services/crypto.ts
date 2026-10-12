const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;
const CRYPTO_VERSION = 2;

/**
 * Derive the vault's AES-GCM key from the password using PBKDF2.
 *
 * Non-extractable: its bytes can never be exported, so the key can be kept across service-worker
 * restarts as a `CryptoKey` object (`vaultSession` in IndexedDB) without any page being able to
 * read or copy the key itself (#245).
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Generate a new random salt and derive key
 */
export async function deriveNewKey(
  password: string,
): Promise<{ key: CryptoKey; salt: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKey(password, salt);
  return { key, salt };
}

/**
 * Derive key from password using salt extracted from existing encrypted data
 */
export async function deriveKeyFromEncryptedVault(
  password: string,
  encryptedData: string,
): Promise<{ key: CryptoKey; salt: Uint8Array }> {
  if (!encryptedData.startsWith('v2:')) {
    throw new Error('Invalid format: expected v2 encrypted data');
  }

  const combined = Uint8Array.from(atob(encryptedData.slice(3)), (c) => c.charCodeAt(0));

  const salt = combined.slice(1, 1 + SALT_LENGTH);
  const key = await deriveKey(password, salt);

  return { key, salt };
}

/**
 * Encrypt data using a pre-derived CryptoKey
 */
export async function encryptWithKey(
  data: unknown,
  key: CryptoKey,
  salt: Uint8Array,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plaintext);

  const combined = new Uint8Array(1 + SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
  combined[0] = CRYPTO_VERSION;
  combined.set(salt, 1);
  combined.set(iv, 1 + SALT_LENGTH);
  combined.set(new Uint8Array(ciphertext), 1 + SALT_LENGTH + IV_LENGTH);

  return 'v2:' + btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt data using a pre-derived CryptoKey
 */
export async function decryptWithKey(encryptedData: string, key: CryptoKey): Promise<unknown> {
  if (!encryptedData.startsWith('v2:')) {
    throw new Error('Invalid format: expected v2 encrypted data');
  }

  const combined = Uint8Array.from(atob(encryptedData.slice(3)), (c) => c.charCodeAt(0));

  const version = combined[0];
  if (version !== CRYPTO_VERSION) {
    throw new Error(`Unsupported crypto version: ${version}`);
  }

  const iv = combined.slice(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(1 + SALT_LENGTH + IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext);

  return JSON.parse(new TextDecoder().decode(plaintext));
}
