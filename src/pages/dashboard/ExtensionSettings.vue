<script lang="ts" setup>
import { onMounted } from 'vue';
import ThemeSwitch from '@/components/dashboard/ThemeSwitch.vue';
import useSettingsStore from '@/stores/settings-store';
import { useI18n } from 'vue-i18n';
import { REQUEST_EXPIRY_OPTION_MINUTES } from '@/services/request-expiry';

const { t } = useI18n();
const settingsStore = useSettingsStore();

// Bounded, discrete choices with no "off" option: expiry is a fail-closed control (ADR D8).
const requestExpiryOptions = REQUEST_EXPIRY_OPTION_MINUTES.map((minutes: number) => ({
  label: t('settings.requestExpiryOptions.minutes', minutes),
  value: minutes,
}));

onMounted(async () => {
  await settingsStore.getSettings();
});
</script>

<template>
  <q-page class="dashboard-page extension-settings-page">
    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('settings.title') }}</h1>
      <p class="dashboard-hero-caption">{{ t('settings.dashboardCaption') }}</p>
    </section>

    <q-card class="dashboard-card extension-settings-page__card">
      <q-card-section>
        <h2 class="text-subtitle1 q-mb-md">{{ t('settings.title') }}</h2>
        <q-list dividers>
          <q-item v-ripple tag="label">
            <q-item-section>
              <q-item-label>{{ t('profile.theme') }}</q-item-label>
              <q-item-label caption lines="2">{{ t('profile.themeCaption') }}</q-item-label>
            </q-item-section>
            <q-item-section side top>
              <theme-switch size="xl" />
            </q-item-section>
          </q-item>

          <q-item v-ripple tag="label">
            <q-item-section>
              <q-item-label>{{ t('settings.quickPublishClientTag') }}</q-item-label>
              <q-item-label caption lines="3">{{
                t('settings.quickPublishClientTagCaption')
              }}</q-item-label>
            </q-item-section>
            <q-item-section side top>
              <q-toggle
                :model-value="settingsStore.quickPublishClientTag"
                :aria-label="t('settings.quickPublishClientTag')"
                @update:model-value="(val) => settingsStore.setQuickPublishClientTag(Boolean(val))"
              />
            </q-item-section>
          </q-item>

          <q-item>
            <q-item-section>
              <q-item-label>{{ t('settings.autoLockVault') }}</q-item-label>
              <q-item-label caption lines="2">
                {{ t('settings.autoLockVaultCaption') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side style="min-width: 140px">
              <q-select
                :model-value="settingsStore.vaultAutoLockMinutes"
                :options="[
                  { label: t('settings.autoLockOptions.off'), value: 0 },
                  { label: t('settings.autoLockOptions.minutes', 1), value: 1 },
                  { label: t('settings.autoLockOptions.minutes', 5), value: 5 },
                  { label: t('settings.autoLockOptions.minutes', 15), value: 15 },
                  { label: t('settings.autoLockOptions.minutes', 30), value: 30 },
                  { label: t('settings.autoLockOptions.minutes', 60), value: 60 },
                ]"
                emit-value
                map-options
                dense
                outlined
                @update:model-value="(val) => settingsStore.setVaultAutoLockMinutes(Number(val))"
              />
            </q-item-section>
          </q-item>

          <q-item>
            <q-item-section>
              <q-item-label>{{ t('settings.requestExpiry') }}</q-item-label>
              <q-item-label caption lines="3">
                {{ t('settings.requestExpiryCaption') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side style="min-width: 140px">
              <q-select
                :model-value="settingsStore.requestExpiryMinutes"
                :options="requestExpiryOptions"
                emit-value
                map-options
                dense
                outlined
                @update:model-value="(val) => settingsStore.setRequestExpiryMinutes(Number(val))"
              />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<style scoped>
.extension-settings-page {
  width: 100%;
}

.extension-settings-page__card {
  overflow: hidden;
}
</style>
