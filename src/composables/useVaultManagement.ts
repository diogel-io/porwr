import { exportVault, importVault } from '@/services/vault-service';
import { saveVaultBackup, type VaultBackupSaveResult } from '@/services/vault-backup-download';
import { ErrorCode } from '@/types/error-codes.d';

/** Why a vault import did not happen. Each one leaves the current vault untouched. */
export type VaultImportFailure = 'invalidFile' | 'wrongPassword' | 'failed';

export type VaultImportResult =
  | { readonly success: true }
  | { readonly success: false; readonly reason: VaultImportFailure };

/** The text of a chosen file. Read with `FileReader`, which every surface Porwr runs in provides. */
const readFileText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file);
  });

/** The default name for a backup saved today: `diogel-vault-backup-<YYYY-MM-DD>.json`. */
export const vaultBackupFileName = (now = new Date()): string =>
  `diogel-vault-backup-${now.toISOString().split('T')[0]}.json`;

export function useVaultManagement() {
  /**
   * Saves an encrypted backup of the vault where the user chooses, through a Save As dialog (#314).
   * The file is the same as before: `version`, the vault's `encryptedData` and `exportedAt`.
   */
  async function exportVaultBackup(): Promise<VaultBackupSaveResult> {
    const result = await exportVault();
    if (!result.success || !result.encryptedData) {
      return { status: 'failed', error: result.error || 'Failed to export vault' };
    }

    const now = new Date();
    const backup = {
      version: 1,
      encryptedData: result.encryptedData,
      exportedAt: now.toISOString(),
    };
    return saveVaultBackup(vaultBackupFileName(now), JSON.stringify(backup, null, 2));
  }

  /**
   * Replaces the vault with the backup in `file`, once the background has proven `password` opens
   * it (#313). Resolves to what happened so the Import vault page can say so in place.
   */
  async function importVaultFromFile(file: File, password: string): Promise<VaultImportResult> {
    let encryptedData: unknown;
    try {
      encryptedData = (JSON.parse(await readFileText(file)) as { encryptedData?: unknown })
        ?.encryptedData;
    } catch {
      return { success: false, reason: 'invalidFile' };
    }
    if (typeof encryptedData !== 'string' || !encryptedData) {
      return { success: false, reason: 'invalidFile' };
    }

    try {
      const result = await importVault(encryptedData, password);
      if (result.success) return { success: true };
      if (result.code === ErrorCode.VLT_INVALID_PASSWORD) {
        return { success: false, reason: 'wrongPassword' };
      }
      if (result.code === ErrorCode.GEN_INVALID_INPUT) {
        return { success: false, reason: 'invalidFile' };
      }
      return { success: false, reason: 'failed' };
    } catch {
      return { success: false, reason: 'failed' };
    }
  }

  return {
    exportVaultBackup,
    importVaultFromFile,
  };
}
