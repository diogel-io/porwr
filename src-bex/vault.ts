import {
  decryptWithKey,
  deriveKeyFromEncryptedVault,
  deriveNewKey,
  encryptWithKey,
} from '@/services/crypto';
import { db } from '@/services/database';
import { LogLevel, logService } from '@/services/log-service';
import { storageService, VAULT_UNLOCKED } from '@/services/storage-service';
import { ErrorCode } from '@/types/error-codes.d';

let vaultKey: CryptoKey | null = null;
let vaultSalt: Uint8Array | null = null;

/**
 * Keeping the vault unlocked across MV3 service-worker restarts (#245).
 *
 * The key is a non-extractable `CryptoKey` and is kept as that object in IndexedDB (`vaultSession`),
 * never as bytes. Porwr's own pages share this origin and so can reach that table: they can *use* the
 * key while the vault is unlocked, but can never read or copy it, so nothing can carry it away for
 * offline decryption. That is the trust boundary this design accepts.
 *
 * IndexedDB outlives the browser session; `chrome.storage.session` does not. So the `VAULT_UNLOCKED`
 * marker in session storage is what says "still the same browser session": the key is restored only
 * when both are present, and a key without the marker is from before a browser restart and is deleted.
 */
const VAULT_SESSION_ID = 'current' as const;

/** Raw key bytes written to session storage before #245. Deleted on sight, never imported. */
const LEGACY_SESSION_KEYS = ['vault:session-key', 'vault:session-salt'];

async function saveKeyToSession(): Promise<void> {
  if (!vaultKey || !vaultSalt) {
    return;
  }

  try {
    await db.vaultSession.put({ id: VAULT_SESSION_ID, key: vaultKey, salt: vaultSalt });
    await storageService.setMultiple({ [VAULT_UNLOCKED]: true }, 'session');
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[Vault] Failed to persist unlock session', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function clearSession() {
  await storageService.remove([VAULT_UNLOCKED, ...LEGACY_SESSION_KEYS], 'session');
  try {
    await db.vaultSession.delete(VAULT_SESSION_ID);
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[Vault] Failed to clear unlock session', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function restoreVaultState(): Promise<boolean> {
  try {
    const items = await storageService.getMultiple(
      [VAULT_UNLOCKED, ...LEGACY_SESSION_KEYS],
      'session',
    );
    if (LEGACY_SESSION_KEYS.some((key) => items[key] !== undefined)) {
      // An unlock from before #245 left raw key bytes behind. Never use them: lock instead.
      await clearSession();
      return false;
    }

    const session = await db.vaultSession.get(VAULT_SESSION_ID);
    if (!session) return false;

    if (items[VAULT_UNLOCKED] !== true) {
      // A new browser session: the key outlived it in IndexedDB, but the vault must start locked.
      await clearSession();
      return false;
    }

    vaultKey = session.key;
    vaultSalt = session.salt;
    return true;
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[Vault] Failed to restore unlock session', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return false;
}

export function isVaultUnlocked(): boolean {
  return vaultKey !== null && vaultSalt !== null;
}

function clearVaultKey() {
  vaultKey = null;
  vaultSalt = null;
}

const unlockListeners = new Set<() => void>();

/**
 * Runs `listener` whenever the password unlocks the vault. For background work that needs the
 * accounts, such as filling the contact cache (#257). A worker that restores an unlocked session
 * at start does not call it; the caller of `restoreVaultState` handles that case.
 */
export function onVaultUnlocked(listener: () => void): () => void {
  unlockListeners.add(listener);
  return () => unlockListeners.delete(listener);
}

export async function unlockVault(password: string) {
  try {
    const vault = await db.vaults.get('master');

    if (!vault) {
      return {
        success: false,
        error: 'No vault found',
        errorCode: ErrorCode.VLT_NOT_CREATED,
      };
    }

    const { key, salt } = await deriveKeyFromEncryptedVault(password, vault.encryptedData);
    const vaultData = await decryptWithKey(vault.encryptedData, key);

    // Only set the key and save the session if decryption succeeded
    vaultKey = key;
    vaultSalt = salt;
    await saveKeyToSession();
    for (const listener of unlockListeners) {
      try {
        listener();
      } catch {
        // A listener's failure must not reach the catch below, which would lock the vault again.
      }
    }

    return { success: true, vaultData };
  } catch {
    clearVaultKey();
    await clearSession();
    return {
      success: false,
      error: 'Invalid password',
      errorCode: ErrorCode.VLT_INVALID_PASSWORD,
    };
  }
}

const lockListeners = new Set<() => void>();
/**
 * Runs `listener` whenever the vault locks, manually or by auto-lock. For anything that holds
 * decrypted material in memory and must drop it with the key.
 */
export function onVaultLocked(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => lockListeners.delete(listener);
}

export async function lockVault() {
  clearVaultKey();
  await clearSession();
  for (const listener of lockListeners) {
    listener();
  }
}

export async function createNewVault(password: string, vaultData: unknown) {
  try {
    const { key, salt } = await deriveNewKey(password);
    const encryptedVault = await encryptWithKey(vaultData, key, salt);

    // Only set the key, save the session, and update the DB if encryption succeeded
    vaultKey = key;
    vaultSalt = salt;
    await saveKeyToSession();

    await db.vaults.put({
      id: 'master',
      encryptedData: encryptedVault,
      createdAt: new Date().toISOString(),
    });

    return { success: true, encryptedVault };
  } catch (error: unknown) {
    clearVaultKey();
    await clearSession();
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create vault',
      errorCode: ErrorCode.GEN_UNKNOWN,
    };
  }
}

/**
 * Fields older vaults carry, never read, so not written back: the mnemonic and passphrase from
 * before #244, and the history of zaps Porwr sent itself, which it no longer does (#271).
 */
const RETIRED_VAULT_FIELDS = ['mnemonic', 'passphrase', 'nip57ZapHistory'];

/** The vault as it is written: without the retired fields, and otherwise exactly as given. */
const withoutRetiredFields = (vaultData: unknown): unknown =>
  vaultData && typeof vaultData === 'object' && !Array.isArray(vaultData)
    ? Object.fromEntries(
        Object.entries(vaultData).filter(([field]) => !RETIRED_VAULT_FIELDS.includes(field)),
      )
    : vaultData;

export async function updateVaultData(vaultData: unknown) {
  if (!isVaultUnlocked() || !vaultKey || !vaultSalt) {
    return {
      success: false,
      error: 'Vault is locked',
      errorCode: ErrorCode.VLT_LOCKED,
    };
  }

  try {
    const encryptedVault = await encryptWithKey(
      withoutRetiredFields(vaultData),
      vaultKey,
      vaultSalt,
    );

    await db.vaults.put({
      id: 'master',
      encryptedData: encryptedVault,
      createdAt: new Date().toISOString(),
    });

    return { success: true };
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[Vault] Failed to update stored vault data', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update vault data',
      errorCode: ErrorCode.GEN_UNKNOWN,
    };
  }
}

export async function getVaultData() {
  if (!isVaultUnlocked() || !vaultKey) {
    return {
      success: false,
      error: 'Vault is locked',
      errorCode: ErrorCode.VLT_LOCKED,
    };
  }

  try {
    const vault = await db.vaults.get('master');
    if (!vault) {
      return {
        success: false,
        error: 'No vault found',
        errorCode: ErrorCode.VLT_NOT_CREATED,
      };
    }

    const vaultData = await decryptWithKey(vault.encryptedData, vaultKey);
    return { success: true, vaultData };
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[Vault] Failed to read vault data', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read vault data',
      errorCode: ErrorCode.GEN_UNKNOWN,
    };
  }
}

export async function exportVault() {
  try {
    const vault = await db.vaults.get('master');
    if (!vault) {
      return {
        success: false,
        error: 'No vault found',
        errorCode: ErrorCode.VLT_NOT_CREATED,
      };
    }
    return { success: true, encryptedData: vault.encryptedData };
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[Vault] Failed to export vault', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to export vault',
      errorCode: ErrorCode.GEN_UNKNOWN,
    };
  }
}

/** A decrypted Porwr vault: an object holding an `accounts` array. */
const isPorwrVault = (vaultData: unknown): boolean =>
  !!vaultData &&
  typeof vaultData === 'object' &&
  !Array.isArray(vaultData) &&
  Array.isArray((vaultData as { accounts?: unknown }).accounts);

/**
 * Replaces the vault with a backup, but only once `password` is proven to open it (#313).
 *
 * The backup is decrypted here first, checked, and the result dropped. A wrong password, a backup
 * that is not a Porwr vault, or a failed write leaves the current vault and its unlock session as
 * they were. Only a successful write locks the vault, through `lockVault`, so anything holding the
 * old vault's material drops it too.
 */
export async function importVault(encryptedData: string, password: string) {
  try {
    if (!encryptedData || !encryptedData.startsWith('v2:')) {
      return {
        success: false,
        error: 'Invalid vault format',
        errorCode: ErrorCode.GEN_INVALID_INPUT,
      };
    }

    let opened: unknown;
    try {
      const { key } = await deriveKeyFromEncryptedVault(password, encryptedData);
      opened = await decryptWithKey(encryptedData, key);
    } catch {
      return {
        success: false,
        error: 'Invalid password',
        errorCode: ErrorCode.VLT_INVALID_PASSWORD,
      };
    }

    if (!isPorwrVault(opened)) {
      return {
        success: false,
        error: 'Invalid vault format',
        errorCode: ErrorCode.GEN_INVALID_INPUT,
      };
    }

    await db.vaults.put({
      id: 'master',
      encryptedData,
      createdAt: new Date().toISOString(),
    });

    await lockVault();

    return { success: true };
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[Vault] Failed to import vault', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to import vault',
      errorCode: ErrorCode.GEN_UNKNOWN,
    };
  }
}

export function getVaultKey() {
  return { key: vaultKey, salt: vaultSalt };
}
