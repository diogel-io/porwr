<script lang="ts" setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import DashboardBreadcrumbs from '@/components/dashboard/DashboardBreadcrumbs.vue';
import { useVaultManagement } from '@/composables/useVaultManagement';
import type { VaultBackupSaveResult } from '@/services/vault-backup-download';

/**
 * Saves an encrypted backup of the vault where the user chooses (#314).
 *
 * Says what the backup is and what is needed to open it again before anything is saved, then hands
 * over to the browser's Save As dialog. Cancelling that dialog is a choice, so it is reported
 * plainly, not as an error.
 */
defineOptions({ name: 'ExportVaultPage' });

const { t } = useI18n();
const { exportVaultBackup } = useVaultManagement();

const saving = ref(false);
const outcome = ref<VaultBackupSaveResult | null>(null);

async function onExport(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  outcome.value = null;
  try {
    outcome.value = await exportVaultBackup();
  } catch (error: unknown) {
    outcome.value = {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <q-page class="dashboard-page dashboard-page--with-breadcrumbs export-vault-page">
    <dashboard-breadcrumbs
      :items="[
        { label: t('navigation.keys.label'), to: { name: 'keys' } },
        { label: t('keyManagement.vaultExport.title') },
      ]"
    />

    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('keyManagement.vaultExport.title') }}</h1>
      <p class="dashboard-hero-caption">{{ t('keyManagement.vaultExport.caption') }}</p>
    </section>

    <q-card class="dashboard-card export-vault-page__card">
      <q-card-section>
        <q-banner rounded class="q-mb-lg" data-testid="vault-export-info">
          <template #avatar>
            <q-icon name="info" color="primary" />
          </template>
          <div class="text-weight-medium q-mb-sm">
            {{ t('keyManagement.vaultExport.infoTitle') }}
          </div>
          <ul class="q-my-none q-pl-md">
            <li>{{ t('keyManagement.vaultExport.whatItIs') }}</li>
            <li>{{ t('keyManagement.vaultExport.password') }}</li>
            <li>{{ t('keyManagement.vaultExport.lostPassword') }}</li>
            <li>{{ t('keyManagement.vaultExport.keepSafe') }}</li>
          </ul>
        </q-banner>

        <div
          v-if="outcome"
          class="q-mb-md"
          role="status"
          data-testid="vault-export-outcome"
          :data-status="outcome.status"
        >
          <div v-if="outcome.status === 'saved'" class="text-positive text-weight-medium">
            {{ t('keyManagement.vaultExport.saved') }}
            <div class="text-caption text-grey-7 export-vault-page__path">
              {{ t('keyManagement.vaultExport.savedTo', { path: outcome.path }) }}
            </div>
          </div>
          <div v-else-if="outcome.status === 'cancelled'" class="text-grey-8">
            {{ t('keyManagement.vaultExport.cancelled') }}
          </div>
          <div v-else class="text-negative text-weight-medium" role="alert">
            {{ t('keyManagement.vaultExport.failed', { error: outcome.error }) }}
          </div>
        </div>

        <div class="row justify-end">
          <q-btn
            class="diogel-btn-primary"
            unelevated
            no-caps
            icon="download"
            data-testid="vault-export-confirm"
            :label="
              saving ? t('keyManagement.vaultExport.saving') : t('keyManagement.vaultExport.button')
            "
            :loading="saving"
            :disable="saving"
            @click="onExport"
          />
        </div>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<style scoped>
.export-vault-page {
  width: 100%;
}

.export-vault-page__card {
  overflow: hidden;
}

.export-vault-page__path {
  overflow-wrap: anywhere;
}
</style>
