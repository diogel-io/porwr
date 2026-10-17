import { useI18n } from 'vue-i18n';
import { exportVault, importVault } from '@/services/vault-service';
import { useQuasar, exportFile } from 'quasar';
import { ErrorCode, formatErrorForUser } from '@/types/error-codes.d';

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

export function useVaultManagement() {
  const { t } = useI18n();
  const $q = useQuasar();

  async function handleExportVault() {
    const result = await exportVault();
    if (result.success && result.encryptedData) {
      const backup = {
        version: 1,
        encryptedData: result.encryptedData,
        exportedAt: new Date().toISOString(),
      };
      const status = exportFile(
        `diogel-vault-backup-${new Date().toISOString().split('T')[0]}.json`,
        JSON.stringify(backup, null, 2),
        'application/json',
      );

      if (status !== true) {
        $q.notify({
          type: 'negative',
          message: t('settings.exportDeny'),
        });
      }
    } else {
      $q.notify({
        type: 'negative',
        message: formatErrorForUser(result.error, result.code as ErrorCode),
      });
    }
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
    handleExportVault,
    importVaultFromFile,
  };
}
