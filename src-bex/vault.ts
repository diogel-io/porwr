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

const SESSION_KEY = 'vault:session-key' as const;
const SESSION_SALT = 'vault:session-salt' as const;

async function saveKeyToSession(): Promise<void> {
  if (!vaultKey || !vaultSalt) {
    return;
  }

  try {
    const rawKey = await crypto.subtle.exportKey('raw', vaultKey);
    const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(rawKey)));
    const saltBase64 = btoa(String.fromCharCode(...vaultSalt));

    await storageService.setMultiple(
      {
        [SESSION_KEY]: keyBase64,
        [SESSION_SALT]: saltBase64,
        [VAULT_UNLOCKED]: true,
      },
      'session',
    );
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[Vault] Failed to persist unlock session', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function clearSession() {
  await storageService.remove([SESSION_KEY, SESSION_SALT, VAULT_UNLOCKED], 'session');
}

export async function restoreVaultState(): Promise<boolean> {
  try {
    const items = await storageService.getMultiple([SESSION_KEY, SESSION_SALT], 'session');
    if (items[SESSION_KEY] && items[SESSION_SALT]) {
      const keyData = Uint8Array.from(atob(items[SESSION_KEY] as string), (character) => character.charCodeAt(0));
      const saltData = Uint8Array.from(atob(items[SESSION_SALT] as string), (character) => character.charCodeAt(0));

      vaultKey = await crypto.subtle.importKey('raw', keyData.buffer, 'AES-GCM', true, [
        'encrypt',
        'decrypt',
      ]);
      vaultSalt = saltData;
      return true;
    }
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

export async function lockVault() {
  clearVaultKey();
  await clearSession();
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

export async function updateVaultData(vaultData: unknown) {
  if (!isVaultUnlocked() || !vaultKey || !vaultSalt) {
    return {
      success: false,
      error: 'Vault is locked',
      errorCode: ErrorCode.VLT_LOCKED
    };
  }

  try {
    const encryptedVault = await encryptWithKey(vaultData, vaultKey, vaultSalt);

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
      errorCode: ErrorCode.GEN_UNKNOWN
    };
  }
}

export async function getVaultData() {
  if (!isVaultUnlocked() || !vaultKey) {
    return {
      success: false,
      error: 'Vault is locked',
      errorCode: ErrorCode.VLT_LOCKED
    };
  }

  try {
    const vault = await db.vaults.get('master');
    if (!vault) {
      return {
        success: false,
        error: 'No vault found',
        errorCode: ErrorCode.VLT_NOT_CREATED
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
      errorCode: ErrorCode.GEN_UNKNOWN
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
        errorCode: ErrorCode.VLT_NOT_CREATED
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
      errorCode: ErrorCode.GEN_UNKNOWN
    };
  }
}

export async function importVault(encryptedData: string) {
  try {
    // Basic validation
    if (!encryptedData || !encryptedData.startsWith('v2:')) {
      return {
        success: false,
        error: 'Invalid vault format',
        errorCode: ErrorCode.GEN_INVALID_INPUT
      };
    }

    await db.vaults.put({
      id: 'master',
      encryptedData,
      createdAt: new Date().toISOString(),
    });

    // When importing a vault, it's safer to clear the current session's key
    clearVaultKey();
    await clearSession();

    return { success: true };
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[Vault] Failed to import vault', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to import vault',
      errorCode: ErrorCode.GEN_UNKNOWN
    };
  }
}

export function getVaultKey() {
  return { key: vaultKey, salt: vaultSalt };
}
