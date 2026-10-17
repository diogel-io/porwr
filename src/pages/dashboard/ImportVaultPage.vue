<script lang="ts" setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useRouter } from 'vue-router';
import DashboardBreadcrumbs from '@/components/dashboard/DashboardBreadcrumbs.vue';
import { type VaultImportFailure, useVaultManagement } from '@/composables/useVaultManagement';

/**
 * Replaces the vault with one from a backup file (#313).
 *
 * Says what importing does before anything happens, and asks for the backup's password. The
 * background proves the password opens the backup before it writes, so any failure here leaves the
 * current vault as it was.
 */
defineOptions({ name: 'ImportVaultPage' });

const { t } = useI18n();
const $q = useQuasar();
const router = useRouter();
const { handleExportVault, importVaultFromFile } = useVaultManagement();

const backupFile = ref<File | null>(null);
const password = ref('');
const showPassword = ref(false);
const importing = ref(false);
const failure = ref<VaultImportFailure | null>(null);

const canImport = computed(() => !!backupFile.value && !!password.value && !importing.value);

async function onImport(): Promise<void> {
  if (!canImport.value || !backupFile.value) return;

  importing.value = true;
  failure.value = null;
  const result = await importVaultFromFile(backupFile.value, password.value);
  password.value = '';
  importing.value = false;

  if (!result.success) {
    failure.value = result.reason;
    return;
  }

  $q.notify({ type: 'positive', message: t('keyManagement.vaultImport.success'), timeout: 8000 });
  await router.push({ name: 'login' });
}

onBeforeUnmount(() => {
  password.value = '';
});
</script>

<template>
  <q-page class="dashboard-page dashboard-page--with-breadcrumbs import-vault-page">
    <dashboard-breadcrumbs
      :items="[
        { label: t('navigation.keys.label'), to: { name: 'keys' } },
        { label: t('keyManagement.vaultImport.title') },
      ]"
    />

    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('keyManagement.vaultImport.title') }}</h1>
      <p class="dashboard-hero-caption">{{ t('keyManagement.vaultImport.caption') }}</p>
    </section>

    <q-card class="dashboard-card import-vault-page__card">
      <q-card-section>
        <q-banner
          rounded
          class="import-vault-page__warning q-mb-lg"
          data-testid="vault-import-warning"
        >
          <template #avatar>
            <q-icon name="warning" color="warning" />
          </template>
          <div class="text-weight-medium q-mb-sm">
            {{ t('keyManagement.vaultImport.warningTitle') }}
          </div>
          <ul class="q-my-none q-pl-md">
            <li>{{ t('keyManagement.vaultImport.replaces') }}</li>
            <li>{{ t('keyManagement.vaultImport.erases') }}</li>
            <li>{{ t('keyManagement.vaultImport.password') }}</li>
            <li>{{ t('keyManagement.vaultImport.exportFirst') }}</li>
          </ul>
          <template #action>
            <q-btn
              class="diogel-btn-secondary"
              outline
              no-caps
              icon="download"
              data-testid="vault-import-export-first"
              :label="t('keyManagement.vaultImport.exportFirstButton')"
              @click="handleExportVault"
            />
          </template>
        </q-banner>

        <div class="q-gutter-md">
          <q-file
            v-model="backupFile"
            filled
            accept=".json"
            data-testid="vault-import-file"
            :label="t('keyManagement.vaultImport.fileLabel')"
            :hint="t('keyManagement.vaultImport.fileHint')"
            :disable="importing"
            @update:model-value="failure = null"
          >
            <template #prepend>
              <q-icon name="attach_file" />
            </template>
          </q-file>

          <q-input
            v-model="password"
            filled
            autocomplete="off"
            data-testid="vault-import-password"
            :type="showPassword ? 'text' : 'password'"
            :label="t('keyManagement.vaultImport.passwordLabel')"
            :disable="importing"
            @update:model-value="failure = null"
            @keyup.enter="onImport"
          >
            <template #append>
              <q-icon
                :name="showPassword ? 'visibility_off' : 'visibility'"
                class="cursor-pointer"
                @click="showPassword = !showPassword"
              />
            </template>
          </q-input>

          <div
            v-if="failure"
            class="text-negative text-weight-medium"
            role="alert"
            data-testid="vault-import-error"
          >
            {{ t(`keyManagement.vaultImport.errors.${failure}`) }}
            {{ t('keyManagement.vaultImport.unchanged') }}
          </div>

          <div class="row justify-end">
            <q-btn
              class="diogel-btn-danger"
              unelevated
              no-caps
              icon="restore"
              data-testid="vault-import-confirm"
              :label="
                importing
                  ? t('keyManagement.vaultImport.checking')
                  : t('keyManagement.vaultImport.confirm')
              "
              :loading="importing"
              :disable="!canImport"
              @click="onImport"
            />
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<style scoped>
.import-vault-page {
  width: 100%;
}

.import-vault-page__card {
  overflow: hidden;
}
</style>
