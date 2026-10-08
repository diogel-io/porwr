<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import ThemeSwitch from '@/components/dashboard/ThemeSwitch.vue';
import useSettingsStore from '@/stores/settings-store';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useVaultManagement } from '@/composables/useVaultManagement';
import { normalizeRelayUrl } from '@/services/relay-url';
import { REQUEST_EXPIRY_OPTION_MINUTES } from '@/services/request-expiry';

const { t } = useI18n();
const $q = useQuasar();
const settingsStore = useSettingsStore();
const profileSearchRelayInput = ref('');

// Bounded, discrete choices with no "off" option: expiry is a fail-closed control (ADR D8).
const requestExpiryOptions = REQUEST_EXPIRY_OPTION_MINUTES.map((minutes: number) => ({
  label: t('settings.requestExpiryOptions.minutes', minutes),
  value: minutes,
}));

const { fileInput, handleExportVault, triggerImport, handleFileImport } =
  useVaultManagement();

onMounted(async () => {
  await settingsStore.getSettings();
});

async function addProfileSearchRelay() {
  const normalized = normalizeRelayUrl(profileSearchRelayInput.value);
  if (!normalized.valid || !normalized.url) {
    $q.notify({ type: 'negative', message: normalized.error ?? t('relays.invalidUrl') });
    return;
  }

  await settingsStore.addProfileSearchRelay(normalized.url);
  profileSearchRelayInput.value = '';
}

async function updateProfileSearchRelay(index: number, value: string | number | null) {
  const normalized = normalizeRelayUrl(String(value ?? ''));
  if (!normalized.valid || !normalized.url) {
    $q.notify({ type: 'negative', message: normalized.error ?? t('relays.invalidUrl') });
    return;
  }

  const nextRelays = [...settingsStore.profileSearchRelays];
  nextRelays[index] = normalized.url;
  await settingsStore.setProfileSearchRelays(nextRelays);
}
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

      <q-separator />

      <q-card-section>
        <h2 class="text-subtitle1 q-mb-md">{{ t('settings.profileSearchRelays') }}</h2>
        <p class="text-caption text-grey-7 q-mb-md">{{ t('settings.profileSearchRelaysCaption') }}</p>
        <q-list bordered separator>
          <q-item v-for="(relay, index) in settingsStore.profileSearchRelays" :key="relay">
            <q-item-section>
              <q-input
                dense
                outlined
                :model-value="relay"
                :aria-label="t('settings.editProfileSearchRelay')"
                @change="updateProfileSearchRelay(index, $event)"
              />
            </q-item-section>
            <q-item-section side>
              <q-btn
                flat
                round
                dense
                color="negative"
                icon="delete"
                :aria-label="t('settings.removeProfileSearchRelay')"
                @click="settingsStore.removeProfileSearchRelay(relay)"
              />
            </q-item-section>
          </q-item>
        </q-list>
        <div class="extension-settings-page__relay-add q-mt-md">
          <q-input
            v-model="profileSearchRelayInput"
            class="extension-settings-page__relay-input"
            dense
            outlined
            :label="t('settings.profileSearchRelayUrl')"
            @keyup.enter="addProfileSearchRelay"
          />
          <q-btn
            color="primary"
            icon="add"
            :label="t('settings.addProfileSearchRelay')"
            @click="addProfileSearchRelay"
          />
        </div>
      </q-card-section>

      <q-separator />

      <q-card-section>
        <h2 class="text-subtitle1 q-mb-md">{{ t('settings.vaultManagement') }}</h2>
        <q-list>
          <q-item>
            <q-item-section>
              <q-item-label>{{ t('settings.exportVault') }}</q-item-label>
              <q-item-label caption>{{ t('settings.exportVaultCaption') }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn
                class="diogel-btn-ghost"
                icon="download"
                :label="t('settings.export')"
                @click="handleExportVault"
              />
            </q-item-section>
          </q-item>

          <q-item>
            <q-item-section>
              <q-item-label>{{ t('settings.importVault') }}</q-item-label>
              <q-item-label caption>{{ t('settings.importVaultCaption') }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn
                class="diogel-btn-ghost"
                icon="upload"
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

.extension-settings-page__relay-add {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.extension-settings-page__relay-input {
  flex: 1;
}

@media (max-width: 700px) {
  .extension-settings-page__relay-add {
    flex-direction: column;
  }

  .extension-settings-page__relay-input {
    width: 100%;
  }
}
</style>
