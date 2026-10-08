<script lang="ts" setup>
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import useSettingsStore from '@/stores/settings-store';

const { t } = useI18n();
const settingsStore = useSettingsStore();

onMounted(async () => {
  await settingsStore.getSettings();
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
                v-model="settingsStore.blossomServer"
                class="q-mt-sm"
                dense
                outlined
                :aria-label="t('profile.blossomServer')"
                @update:model-value="(val) => settingsStore.setBlossomServer(String(val))"
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
