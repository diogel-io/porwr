<script lang="ts" setup>
import { useI18n } from 'vue-i18n';

/**
 * Backs up and restores the whole vault (#297).
 *
 * This lives on the Keys page rather than in Settings because the vault is what holds the keys. Backup
 * and restore each have their own page, which explains what it does before anything happens (#313,
 * #314); this only links to them. Backup comes first, so it is on the left side by side and on top
 * when stacked (#390).
 */
defineOptions({ name: 'VaultBackupCard' });

const { t } = useI18n();
</script>

<template>
  <q-card class="dashboard-card vault-backup-card">
    <q-card-section>
      <h2 class="text-subtitle1 q-mb-md">{{ t('keyManagement.vaultBackup.title') }}</h2>

      <div class="row q-col-gutter-lg justify-between">
        <div class="col-12 col-sm-6 vault-backup-card__backup" data-testid="vault-backup-backup">
          <div class="text-body2 text-weight-medium">
            {{ t('keyManagement.vaultBackup.backup') }}
          </div>
          <p class="text-caption text-grey-7 q-mt-xs q-mb-sm">
            {{ t('keyManagement.vaultBackup.backupCaption') }}
          </p>
          <q-btn
            class="diogel-btn-secondary"
            outline
            icon="download"
            no-caps
            :label="t('keyManagement.vaultBackup.backup')"
            :to="{ name: 'export-vault' }"
          />
        </div>

        <div class="col-12 col-sm-6 vault-backup-card__restore" data-testid="vault-backup-restore">
          <div class="text-body2 text-weight-medium">
            {{ t('keyManagement.vaultBackup.restore') }}
          </div>
          <p class="text-caption text-grey-7 q-mt-xs q-mb-sm">
            {{ t('keyManagement.vaultBackup.restoreCaption') }}
          </p>
          <q-btn
            class="diogel-btn-secondary"
            outline
            icon="upload"
            no-caps
            :label="t('keyManagement.vaultBackup.restore')"
            :to="{ name: 'import-vault' }"
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
  .vault-backup-card__restore {
    text-align: right;
  }
}
</style>
