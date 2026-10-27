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
 * Says what restoring does before anything happens, and asks for the backup's password. The
 * background proves the password opens the backup before it writes, so any failure here leaves the
 * current vault as it was. The note's only link is to the documentation (#392).
 */
defineOptions({ name: 'RestoreVaultPage' });

const DOCS_URL = 'https://diogel.io/docs/porwr';

const { t } = useI18n();
const $q = useQuasar();
const router = useRouter();
const { importVaultFromFile } = useVaultManagement();

const backupFile = ref<File | null>(null);
const password = ref('');
const showPassword = ref(false);
const restoring = ref(false);
const failure = ref<VaultImportFailure | null>(null);

const canRestore = computed(() => !!backupFile.value && !!password.value && !restoring.value);

async function onRestore(): Promise<void> {
  if (!canRestore.value || !backupFile.value) return;

  restoring.value = true;
  failure.value = null;
  const result = await importVaultFromFile(backupFile.value, password.value);
  password.value = '';
  restoring.value = false;

  if (!result.success) {
    failure.value = result.reason;
    return;
  }

  $q.notify({ type: 'positive', message: t('keyManagement.vaultRestore.success'), timeout: 8000 });
  await router.push({ name: 'login' });
}

onBeforeUnmount(() => {
  password.value = '';
});
</script>

<template>
  <q-page class="dashboard-page dashboard-page--with-breadcrumbs restore-vault-page">
    <dashboard-breadcrumbs
      :items="[
        { label: t('navigation.keys.label'), to: { name: 'keys' } },
        { label: t('keyManagement.vaultRestore.title') },
      ]"
    />

    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('keyManagement.vaultRestore.title') }}</h1>
      <p class="dashboard-hero-caption">{{ t('keyManagement.vaultRestore.caption') }}</p>
    </section>

    <q-card class="dashboard-card restore-vault-page__card">
      <q-card-section>
        <q-banner
          rounded
          class="restore-vault-page__warning q-mb-lg"
          data-testid="vault-restore-warning"
        >
          <template #avatar>
            <q-icon name="warning" color="warning" />
          </template>
          <div class="text-weight-medium q-mb-sm">
            {{ t('keyManagement.vaultRestore.warningTitle') }}
          </div>
          <ul class="q-my-none q-pl-md">
            <li>{{ t('keyManagement.vaultRestore.replaces') }}</li>
            <li>{{ t('keyManagement.vaultRestore.erases') }}</li>
            <li>{{ t('keyManagement.vaultRestore.password') }}</li>
            <li>{{ t('keyManagement.vaultRestore.backupFirst') }}</li>
            <i18n-t keypath="keyManagement.vaultRestore.docs" tag="li" scope="global">
              <template #link>
                <a
                  :href="DOCS_URL"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="vault-restore-docs"
                  >{{ t('keyManagement.vaultRestore.docsLink') }}</a
                >
              </template>
            </i18n-t>
          </ul>
        </q-banner>

        <div class="q-gutter-md">
          <q-file
            v-model="backupFile"
            filled
            accept=".json"
            data-testid="vault-restore-file"
            :label="t('keyManagement.vaultRestore.fileLabel')"
            :hint="t('keyManagement.vaultRestore.fileHint')"
            :disable="restoring"
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
            data-testid="vault-restore-password"
            :type="showPassword ? 'text' : 'password'"
            :label="t('keyManagement.vaultRestore.passwordLabel')"
            :disable="restoring"
            @update:model-value="failure = null"
            @keyup.enter="onRestore"
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
            data-testid="vault-restore-error"
          >
            {{ t(`keyManagement.vaultRestore.errors.${failure}`) }}
            {{ t('keyManagement.vaultRestore.unchanged') }}
          </div>

          <div class="row justify-end">
            <q-btn
              class="diogel-btn-danger"
              unelevated
              no-caps
              icon="restore"
              data-testid="vault-restore-confirm"
              :label="
                restoring
                  ? t('keyManagement.vaultRestore.checking')
                  : t('keyManagement.vaultRestore.confirm')
              "
              :loading="restoring"
              :disable="!canRestore"
              @click="onRestore"
            />
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<style scoped>
.restore-vault-page {
  width: 100%;
}

.restore-vault-page__card {
  overflow: hidden;
}
</style>
