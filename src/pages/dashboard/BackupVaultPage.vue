<script lang="ts" setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import DashboardBreadcrumbs from '@/components/dashboard/DashboardBreadcrumbs.vue';
import { useVaultManagement } from '@/composables/useVaultManagement';
import { PORWR_DOCS_URL } from '@/data/docs';
import type { VaultBackupSaveResult } from '@/services/vault-backup-download';

/**
 * Saves an encrypted backup of the vault where the user chooses (#314).
 *
 * Says what the backup is and what is needed to open it again before anything is saved, then hands
 * over to the browser's Save As dialog. Cancelling that dialog is a choice, so it is reported
 * plainly, not as an error. The note's only link is to the documentation (#391).
 */
defineOptions({ name: 'BackupVaultPage' });

const { t } = useI18n();
const { exportVaultBackup } = useVaultManagement();

const saving = ref(false);
const outcome = ref<VaultBackupSaveResult | null>(null);

async function onBackup(): Promise<void> {
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
  <q-page class="dashboard-page dashboard-page--with-breadcrumbs backup-vault-page">
    <dashboard-breadcrumbs
      :items="[
        { label: t('navigation.keys.label'), to: { name: 'keys' } },
        { label: t('keyManagement.vaultBackup.title') },
      ]"
    />

    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('keyManagement.vaultBackup.title') }}</h1>
      <p class="dashboard-hero-caption">{{ t('keyManagement.vaultBackup.caption') }}</p>
    </section>

    <q-card class="dashboard-card backup-vault-page__card">
      <q-card-section>
        <q-banner rounded class="q-mb-lg" data-testid="vault-backup-info">
          <template #avatar>
            <q-icon name="info" color="primary" />
          </template>
          <div class="text-weight-medium q-mb-sm">
            {{ t('keyManagement.vaultBackup.infoTitle') }}
          </div>
          <ul class="q-my-none q-pl-md">
            <li>{{ t('keyManagement.vaultBackup.whatItIs') }}</li>
            <li>{{ t('keyManagement.vaultBackup.password') }}</li>
            <li>{{ t('keyManagement.vaultBackup.lostPassword') }}</li>
            <li>{{ t('keyManagement.vaultBackup.keepSafe') }}</li>
            <li>{{ t('keyManagement.vaultBackup.separatePlace') }}</li>
            <i18n-t keypath="keyManagement.vaultBackup.docs" tag="li" scope="global">
              <template #link>
                <a
                  :href="PORWR_DOCS_URL"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="vault-backup-docs"
                  >{{ t('keyManagement.vaultBackup.docsLink') }}</a
                >
              </template>
            </i18n-t>
          </ul>
        </q-banner>

        <div
          v-if="outcome"
          class="q-mb-md"
          role="status"
          data-testid="vault-backup-outcome"
          :data-status="outcome.status"
        >
          <div v-if="outcome.status === 'saved'" class="text-positive text-weight-medium">
            {{ t('keyManagement.vaultBackup.saved') }}
            <div class="text-caption text-grey-7 backup-vault-page__path">
              {{ t('keyManagement.vaultBackup.savedTo', { path: outcome.path }) }}
            </div>
          </div>
          <div v-else-if="outcome.status === 'cancelled'" class="text-grey-8">
            {{ t('keyManagement.vaultBackup.cancelled') }}
          </div>
          <div v-else class="text-negative text-weight-medium" role="alert">
            {{ t('keyManagement.vaultBackup.failed', { error: outcome.error }) }}
          </div>
        </div>

        <div class="row justify-end">
          <q-btn
            class="diogel-btn-primary"
            unelevated
            no-caps
            icon="download"
            data-testid="vault-backup-confirm"
            :label="
              saving ? t('keyManagement.vaultBackup.saving') : t('keyManagement.vaultBackup.button')
            "
            :loading="saving"
            :disable="saving"
            @click="onBackup"
          />
        </div>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<style scoped>
.backup-vault-page {
  width: 100%;
}

.backup-vault-page__card {
  overflow: hidden;
}

.backup-vault-page__path {
  overflow-wrap: anywhere;
}
</style>
