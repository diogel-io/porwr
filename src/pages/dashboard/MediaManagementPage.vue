<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import useSettingsStore from '@/stores/settings-store';
import { normalizeBlossomServer } from '@/services/blossom-server';

const { t } = useI18n();
const settingsStore = useSettingsStore();

// Edited locally and saved only once it is a valid https:// URL, so a half-typed or http:// value
// never becomes the upload target (T21).
const serverInput = ref(settingsStore.blossomServer);
const serverError = computed(() => {
  const result = normalizeBlossomServer(serverInput.value);
  return result.valid ? '' : (result.error ?? '');
});

// Follows a change made elsewhere, in another tab or through storage. A value this field just saved
// comes back normalised (a trailing slash added), so it is recognised as its own and not written
// over what is being typed.
watch(
  () => settingsStore.blossomServer,
  (stored) => {
    if (normalizeBlossomServer(serverInput.value).url !== stored) {
      serverInput.value = stored;
    }
  },
);

async function updateServer(value: string | number | null): Promise<void> {
  serverInput.value = String(value ?? '');
  if (serverError.value === '') {
    await settingsStore.setBlossomServer(serverInput.value);
  }
}

onMounted(async () => {
  await settingsStore.getSettings();
  serverInput.value = settingsStore.blossomServer;
});
</script>

<template>
  <q-page class="dashboard-page media-management-page">
    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('mediaManagement.title') }}</h1>
      <p class="dashboard-hero-caption">{{ t('mediaManagement.dashboardCaption') }}</p>
    </section>

    <q-card class="dashboard-card media-management-page__card">
      <q-card-section>
        <h2 class="text-subtitle1 q-mb-md">{{ t('profile.blossomServer') }}</h2>
        <q-list>
          <q-item>
            <q-item-section>
              <q-item-label>{{ t('profile.blossomServer') }}</q-item-label>
              <q-item-label caption>{{ t('profile.blossomServerCaption') }}</q-item-label>
              <q-input
                :model-value="serverInput"
                class="q-mt-sm"
                dense
                outlined
                :aria-label="t('profile.blossomServer')"
                :error="serverError !== ''"
                :error-message="serverError"
                @update:model-value="updateServer"
              />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<style scoped>
.media-management-page {
  width: 100%;
}

.media-management-page__card {
  overflow: hidden;
}
</style>
