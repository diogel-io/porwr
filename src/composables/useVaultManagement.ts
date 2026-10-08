import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { exportVault, importVault } from '@/services/vault-service';
import { useQuasar, exportFile } from 'quasar';
import { useRouter } from 'vue-router';
import type { ErrorCode } from '@/types/error-codes.d';
import { formatErrorForUser } from '@/types/error-codes.d';

export function useVaultManagement() {
  const { t } = useI18n();
  const $q = useQuasar();
  const router = useRouter();
  const fileInput = ref<HTMLInputElement | null>(null);

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

  function triggerImport() {
    fileInput.value?.click();
  }

  function handleFileImport(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    $q.dialog({
      title: t('settings.importVault'),
      message: t('settings.importConfirm'),
      cancel: true,
      persistent: true,
    }).onOk(() => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const backup = JSON.parse(content);

          if (!backup.encryptedData) {
            $q.notify({
              type: 'negative',
              message: t('settings.importInvalid'),
            });
            return;
          }

          importVault(backup.encryptedData)
            .then((result) => {
              if (result.success) {
                $q.notify({
                  type: 'positive',
                  message: t('settings.importSuccess'),
                });
                void router.push({ name: 'login' });
              } else {
                $q.notify({
                  type: 'negative',
                  message: formatErrorForUser(result.error, result.code as ErrorCode),
                });
              }
            })
            .catch((err) => {
              $q.notify({
                type: 'negative',
                message: (err as Error).message || t('settings.importError'),
              });
            });
        } catch (err) {
          $q.notify({
            type: 'negative',
            message: t('settings.importParseError') + (err as Error).message,
          });
        }
      };
      reader.readAsText(file);
    });
  }

  return {
    fileInput,
    handleExportVault,
    triggerImport,
    handleFileImport,
  };
}
