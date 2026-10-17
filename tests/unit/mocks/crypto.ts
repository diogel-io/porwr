/**
 * Web Crypto API mocks for testing
 */

export class MockCrypto {
  private static readonly keyIds = new WeakMap<CryptoKey, number>();
  private static readonly passwordIds = new WeakMap<CryptoKey, number>();

  private static assignKeyId(key: CryptoKey, id?: number): CryptoKey {
    if (!MockCrypto.keyIds.has(key)) {
      const keyId = typeof id === 'number' ? id : Math.floor(Math.random() * 256);
      MockCrypto.keyIds.set(key, keyId);
    }
    return key;
  }

  static get subtle(): SubtleCrypto {
    return {
      // Mock PBKDF2 key derivation
      async deriveKey(
        algorithm: Pbkdf2Params,
        baseKey: CryptoKey,
        derivedKeyAlgorithm: AesKeyGenParams,
        extractable: boolean,
        keyUsages: KeyUsage[],
      ): Promise<CryptoKey> {
        const key = {
          algorithm: derivedKeyAlgorithm,
          extractable,
          type: 'secret',
          usages: keyUsages,
        } as CryptoKey;
        // Deterministic key id based on salt + password
        const salt = new Uint8Array(algorithm.salt as ArrayBuffer);
        const saltId = salt.reduce((acc, b) => (acc + b) & 0xff, 0);
        const pwdId = MockCrypto.passwordIds.get(baseKey) ?? 0;
        const id = (saltId + pwdId) & 0xff;
        return Promise.resolve(MockCrypto.assignKeyId(key, id));
      },

      // Mock AES-GCM encryption
      async encrypt(
        algorithm: AesGcmParams,
        key: CryptoKey,
        data: BufferSource,
      ): Promise<ArrayBuffer> {
        // Simple mock: prepend IV and return, but encode key id in the last byte (auth tag)
        const iv = algorithm.iv as Uint8Array;
        const input = new Uint8Array(data as ArrayBuffer);
        const output = new Uint8Array(iv.length + input.length + 16); // +16 for tag
        output.set(iv, 0);
        output.set(input, iv.length);
        // const keyId = MockCrypto.keyIds.get(key) ?? 0;
        output[output.length - 1] = MockCrypto.keyIds.get(key) ?? 0;
        return Promise.resolve(output.buffer);
      },

      // Mock AES-GCM decryption
      async decrypt(
        algorithm: AesGcmParams,
        key: CryptoKey,
        data: BufferSource,
      ): Promise<ArrayBuffer> {
        const input = new Uint8Array(data as ArrayBuffer);
        const ivLength = 12; // Standard GCM IV length
        const keyId = MockCrypto.keyIds.get(key) ?? 0;
        const tagKeyId = input[input.length - 1];
        if (tagKeyId !== keyId) {
          return Promise.reject(new Error('Authentication failed'));
        }
        return Promise.resolve(input.slice(ivLength, -16).buffer); // Remove IV and tag
      },

      // Mock importKey
      async importKey(
        format: KeyFormat,
        keyData: BufferSource,
        algorithm: AlgorithmIdentifier,
        extractable: boolean,
        keyUsages: KeyUsage[],
      ): Promise<CryptoKey> {
        const key = {
          algorithm,
          extractable,
          type: 'secret',
          usages: keyUsages,
        } as CryptoKey;
        // If importing a PBKDF2 base key from password bytes, store a simple hash
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (format === 'raw' && (algorithm as any) === 'PBKDF2') {
          const bytes = new Uint8Array(keyData as ArrayBuffer);
          const pwdId = bytes.reduce((acc, b) => (acc + b) & 0xff, 0);
          MockCrypto.passwordIds.set(key, pwdId);
        }
        return Promise.resolve(MockCrypto.assignKeyId(key));
      },

      // Mock generateKey
      async generateKey(
        algorithm: AlgorithmIdentifier,
        extractable: boolean,
        keyUsages: KeyUsage[],
      ): Promise<CryptoKey> {
        const key = {
          algorithm,
          extractable,
          type: 'secret',
          usages: keyUsages,
        } as CryptoKey;
        return Promise.resolve(MockCrypto.assignKeyId(key));
      },

      // Mock exportKey
      async exportKey(format: 'raw' | 'jwk', key: CryptoKey): Promise<ArrayBuffer | JsonWebKey> {
        if (format === 'raw') {
          // Return a 32-byte pseudo key
          return Promise.resolve(new Uint8Array(32).fill(0x11).buffer);
        }
        return Promise.resolve({
          kty: 'oct',
          k: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        } as unknown as JsonWebKey);
      },

      // Mock digest
      async digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
        // Return a dummy digest
        return Promise.resolve(new Uint8Array(32).fill(0).buffer);
      },
    } as SubtleCrypto;
  }

  static getRandomValues<T extends ArrayBufferView>(array: T): T {
    for (let i = 0; i < (array as unknown as number[]).length; i++) {
      (array as unknown as number[])[i] = Math.floor(Math.random() * 256);
    }
    return array;
  }
}

// Install mock globally for tests
export function installCryptoMock() {
  Object.defineProperty(globalThis, 'crypto', {
    value: MockCrypto,
    writable: true,
    configurable: true,
  });
}
