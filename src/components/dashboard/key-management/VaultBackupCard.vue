<script lang="ts" setup>
import { useI18n } from 'vue-i18n';
import { useVaultManagement } from '@/composables/useVaultManagement';

/**
 * Backs up and restores the whole vault (#297).
 *
 * This lives on the Keys page rather than in Settings because the vault is what holds the keys. The
 * behaviour is `useVaultManagement`'s; this only places the controls.
 */
defineOptions({ name: 'VaultBackupCard' });

const { t } = useI18n();
const { fileInput, handleExportVault, triggerImport, handleFileImport } = useVaultManagement();
</script>

<template>
  <q-card class="dashboard-card vault-backup-card">
    <q-card-section>
      <h2 class="text-subtitle1 q-mb-md">{{ t('keyManagement.vaultBackup.title') }}</h2>

      <div class="row q-col-gutter-lg justify-between">
        <div class="col-12 col-sm-6 vault-backup-card__import" data-testid="vault-backup-import">
          <div class="text-body2 text-weight-medium">{{ t('settings.importVault') }}</div>
          <p class="text-caption text-grey-7 q-mt-xs q-mb-sm">
            {{ t('settings.importVaultCaption') }}
          </p>
          <q-btn
            class="diogel-btn-secondary"
            outline
            icon="upload"
            no-caps
            :label="t('settings.import')"
            @click="triggerImport"
          />
          <input
            ref="fileInput"
            accept=".json"
            style="display: none"
            type="file"
            @change="handleFileImport"
          />
        </div>

        <div class="col-12 col-sm-6 vault-backup-card__export" data-testid="vault-backup-export">
          <div class="text-body2 text-weight-medium">{{ t('settings.exportVault') }}</div>
          <p class="text-caption text-grey-7 q-mt-xs q-mb-sm">
            {{ t('settings.exportVaultCaption') }}
          </p>
          <q-btn
            class="diogel-btn-secondary"
            outline
            icon="download"
            no-caps
            :label="t('settings.export')"
            @click="handleExportVault"
          />
        </div>
      </div>
    </q-card-section>
  </q-card>
</template>

<style scoped>
.vault-backup-card {
  overflow: hidden;
}

/* Side by side from Quasar's `sm` breakpoint, where `col-sm-6` takes effect; stacked below it. */
@media (min-width: 600px) {
  .vault-backup-card__export {
    text-align: right;
  }
}
</style>
