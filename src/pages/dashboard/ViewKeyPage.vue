<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { type QInput, useQuasar } from 'quasar';

import type { AccountSummary } from '@/types/accounts';
import useAccountStore from '@/stores/account-store';
import ViewStoredKey from '@/components/dashboard/ViewStoredKey.vue';
import ExportButton from '@/components/dashboard/ExportButton.vue';
import SecurityWarning from '@/components/dashboard/SecurityWarning.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const accountStore = useAccountStore();

const aliasInputRef = ref<QInput | null>(null);
const isSaving = ref(false);
const originalAlias = ref('');
const storedKey = ref<AccountSummary | undefined>(undefined);
const alias = ref('');

const requestedAlias = computed(() => String(route.params.alias ?? ''));
const trimmedAlias = computed(() => alias.value.trim());

watch(
  () => requestedAlias.value,
  async () => {
    await accountStore.getKeys();
    const selected = Array.from(accountStore.storedKeys).find(
      (item) => item.alias === requestedAlias.value,
    );
    storedKey.value = selected;
    originalAlias.value = selected?.alias ?? '';
    alias.value = selected?.alias ?? '';
  },
  { immediate: true },
);

function validateAlias(): boolean {
  if (!trimmedAlias.value) {
    $q.notify({ type: 'negative', message: String(t('validation.profileNameRequired')) });
    aliasInputRef.value?.focus();
    return false;
  }

  if (
    trimmedAlias.value === t('account.mainAccountReserved') &&
    originalAlias.value !== trimmedAlias.value
  ) {
    $q.notify({
      type: 'negative',
      message: t('account.mainAccountReservedError', { name: t('account.mainAccountReserved') }),
    });
    aliasInputRef.value?.focus();
    return false;
  }

  return true;
}

async function saveAlias() {
  if (!storedKey.value || isSaving.value) return;
  if (!validateAlias()) return;

  const nextAlias = trimmedAlias.value;
  const currentAlias = originalAlias.value;

  if (nextAlias === currentAlias) {
    return;
  }

  isSaving.value = true;
  try {
    await accountStore.renameKeyAlias(currentAlias, nextAlias);
    originalAlias.value = nextAlias;
    alias.value = nextAlias;
    await router.replace({ name: 'view-key', params: { alias: nextAlias } });
    $q.notify({ type: 'positive', message: String(t('keyManagement.aliasSaved')) });
  } catch (error: unknown) {
    $q.notify({
      type: 'negative',
      message: error instanceof Error ? error.message : String(t('keyManagement.aliasSaveFailed')),
    });
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <q-page class="dashboard-page view-key-page">
    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('keyManagement.viewTitle') }}</h1>
      <p class="dashboard-hero-caption">{{ t('keyManagement.viewCaption') }}</p>
    </section>

    <security-warning
      :icon="t('warning.icon')"
      :title="t('warning.title')"
      :message="t('warning.message')"
    />

    <q-card v-if="storedKey" class="dashboard-card view-key-page__card">
      <q-card-section class="q-pa-lg">
        <div class="row items-end q-col-gutter-md">
          <q-input
            ref="aliasInputRef"
            v-model="alias"
            class="col text-input"
            :label="t('account.profileName')"
            :rules="[
              (v) => !!String(v ?? '').trim() || String(t('validation.profileNameRequired')),
            ]"
            lazy-rules
            hide-bottom-space
          >
            <template v-slot:prepend>
              <q-icon name="person" />
            </template>
          </q-input>

          <div class="col-auto">
            <q-btn
              :disable="isSaving"
              :label="t('keyManagement.saveAlias')"
              class="diogel-btn-primary"
              no-caps
              @click="saveAlias"
            />
          </div>
        </div>
      </q-card-section>

      <q-separator inset />

      <q-card-section class="q-pa-lg">
        <view-stored-key :stored-key="storedKey" />
      </q-card-section>

      <q-card-section class="row justify-end q-pa-lg q-pt-none">
        <ExportButton :stored-key="storedKey" />
      </q-card-section>

    </q-card>

    <q-card v-else class="dashboard-card">
      <q-card-section class="text-center q-pa-xl">
        <q-icon color="grey-5" name="key_off" size="4em" />
        <div class="text-h6 text-grey-7 q-mt-md">{{ t('keyManagement.keyNotFound') }}</div>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<style scoped>
.view-key-page {
  width: 100%;
}

.view-key-page__card {
  overflow: hidden;
}
</style>
