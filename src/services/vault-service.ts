import { db } from './database';
import { ErrorCode } from '@/types/error-codes.d';
import { LogLevel, logService } from './log-service';
import type { VaultData } from '@/types/bridge';
import type { VaultView } from '@/types/accounts';
import { sendBexMessage } from './bridge-client';

// Re-exported for existing callers; the implementation moved to `bridge-client.ts` when the
// sidebar needed retry behaviour for a surface that outlives service-worker restarts.
export { sendBexMessage };

export async function unlockVault(
  password: string,
): Promise<{ success: boolean; error?: string; code?: string }> {
  try {
    const data = await sendBexMessage('vault.unlock', { password });
    return (
      (data as { success: boolean; error?: string; code?: string }) || {
        success: false,
        error: 'No response from background',
        code: ErrorCode.GEN_UNKNOWN,
      }
    );
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[VaultService] Failed to unlock vault', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      code: ErrorCode.GEN_UNKNOWN,
    };
  }
}

export async function lockVault() {
  try {
    await sendBexMessage('vault.lock');
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[VaultService] Failed to lock vault', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createVault(
  password: string,
  vaultData: VaultData,
): Promise<{
  success: boolean;
  error?: string;
  code?: string;
  encryptedVault?: string;
}> {
  try {
    const data = await sendBexMessage('vault.create', { password, vaultData });
    return (
      (data as {
        success: boolean;
        error?: string;
        code?: string;
        encryptedVault?: string;
      }) || {
        success: false,
        error: 'No response from background',
        code: ErrorCode.GEN_UNKNOWN,
      }
    );
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[VaultService] Failed to create vault', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      code: ErrorCode.GEN_UNKNOWN,
    };
  }
}

export async function isVaultUnlocked(): Promise<boolean> {
  try {
    const data = await sendBexMessage('vault.isUnlocked');
    return !!data;
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[VaultService] Failed to check if vault is unlocked', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * The vault as a page may see it: accounts by id, alias and creation date, with no private key,
 * mnemonic, passphrase or wallet secret in it (#240). Changes go through the `accounts.*` actions.
 */
export async function getVaultView(): Promise<VaultView> {
  const response = await sendBexMessage('vault.getView');
  if (!response || typeof response !== 'object' || !('accounts' in response) || !Array.isArray(response.accounts)) {
    const error = response && typeof response === 'object' && 'error' in response ? String(response.error) : 'No response from background';
    throw new Error(error);
  }
  return response;
}

export async function hasVault() {
  logService.log(LogLevel.DEBUG, '[VaultService] Checking if vault exists via direct DB access');
  try {
    const vault = await Promise.race([
      db.vaults.get('master'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database timeout')), 2000)),
    ]);
    logService.log(LogLevel.DEBUG, '[VaultService] hasVault result', { exists: !!vault });
    return !!vault;
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[VaultService] Failed to check if vault exists', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function exportVault(): Promise<{
  success: boolean;
  encryptedData?: string;
  error?: string;
  code?: string;
}> {
  try {
    const data = await sendBexMessage('vault.export');
    return (
      (data as {
        success: boolean;
        encryptedData?: string;
        error?: string;
        code?: string;
      }) || {
        success: false,
        error: 'No response from background',
        code: ErrorCode.GEN_UNKNOWN,
      }
    );
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[VaultService] Failed to export vault', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      code: ErrorCode.GEN_UNKNOWN,
    };
  }
}

export async function importVault(
  encryptedData: string,
): Promise<{ success: boolean; error?: string; code?: string }> {
  try {
    const data = await sendBexMessage('vault.import', { encryptedData });
    return (
      (data as { success: boolean; error?: string; code?: string }) || {
        success: false,
        error: 'No response from background',
        code: ErrorCode.GEN_UNKNOWN,
      }
    );
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[VaultService] Failed to import vault', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      code: ErrorCode.GEN_UNKNOWN,
    };
  }
}
