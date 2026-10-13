<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { normalizeRelayUrl } from '@/services/relay-url';
import useSettingsStore from '@/stores/settings-store';
import type { RelayCatalogEntry } from '@/types/relay';
import RelayBrowserModal from '@/components/dashboard/RelayBrowserModal.vue';

defineOptions({ name: 'ProfileSearchRelayEditor' });

/**
 * The relays contact search asks for profiles. One list for the whole extension, not per account,
 * so this card needs no active account.
 *
 * Edits stay local until Save, like the other relay cards (#263).
 */

const $q = useQuasar();
const { t } = useI18n();
const settingsStore = useSettingsStore();

const relays = ref<string[]>([]);
const savedSnapshot = ref<string[]>([]);
const newRelayUrl = ref('');
const loading = ref(true);
const saving = ref(false);
const showRelayBrowser = ref(false);

const isDirty = computed(
  () => JSON.stringify(relays.value) !== JSON.stringify(savedSnapshot.value),
);

function showStored() {
  relays.value = [...settingsStore.profileSearchRelays];
  savedSnapshot.value = [...settingsStore.profileSearchRelays];
}

function addRelay() {
  const normalized = normalizeRelayUrl(newRelayUrl.value);
  if (!normalized.valid || !normalized.url) {
    $q.notify({ type: 'negative', message: normalized.error ?? t('relays.invalidUrl') });
    return;
  }
  if (!relays.value.includes(normalized.url)) {
    relays.value = [...relays.value, normalized.url];
  }
  newRelayUrl.value = '';
}

function removeRelay(index: number) {
  relays.value = relays.value.filter((_, i) => i !== index);
}

function handleRelaySelected(relay: RelayCatalogEntry) {
  newRelayUrl.value = relay.url;
}

async function saveRelays() {
  saving.value = true;
  try {
    // The store falls back to the default relays when the list is empty, so show what it kept.
    await settingsStore.setProfileSearchRelays(relays.value);
    showStored();
    $q.notify({ type: 'positive', message: t('relays.profileSearch.saveSuccess') });
  } catch (error) {
    console.error('Error saving profile search relays:', error);
    $q.notify({ type: 'negative', message: t('relays.profileSearch.saveError') });
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    await settingsStore.getSettings();
  } finally {
    showStored();
    loading.value = false;
  }
});
</script>

<template>
  <div class="q-pa-md profile-search-relay-editor">
    <div class="text-h6">{{ t('relays.profileSearch.title') }}</div>
    <p class="text-caption text-grey-7 q-mb-md">{{ t('relays.profileSearch.caption') }}</p>

    <div v-if="loading" class="flex justify-center q-my-md" role="status">
      <q-spinner color="primary" size="3em" />
    </div>

    <template v-else>
      <div class="row q-col-gutter-sm items-center q-mb-md">
        <div class="col-grow">
          <q-input
            v-model="newRelayUrl"
            :label="t('relays.profileSearch.url')"
            dense
            outlined
            @keyup.enter="addRelay"
          >
            <template #append>
              <q-btn flat round dense icon="explore" @click="showRelayBrowser = true">
                <q-tooltip>{{ t('relays.browse') }}</q-tooltip>
              </q-btn>
            </template>
          </q-input>
        </div>
        <div class="col-auto">
          <q-btn
            class="diogel-btn-primary"
            icon="add"
            round
            :aria-label="t('relays.profileSearch.add')"
            @click="addRelay"
          />
        </div>
      </div>

      <q-list v-if="relays.length > 0" bordered separator>
        <q-item v-for="(relay, index) in relays" :key="relay">
          <q-item-section>
            <q-item-label>{{ relay }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-btn
              class="diogel-btn-ghost"
              icon="delete"
              round
              size="sm"
              :aria-label="t('relays.profileSearch.remove', { url: relay })"
              @click="removeRelay(index)"
            />
          </q-item-section>
        </q-item>
      </q-list>

      <div v-else class="text-center q-pa-md text-grey">
        {{ t('relays.profileSearch.empty') }}
      </div>

      <div class="row justify-end items-center q-gutter-md q-mt-lg">
        <span
          v-if="isDirty"
          class="text-caption text-warning"
          data-testid="profile-search-relays-unsaved"
        >
          {{ t('relays.profileSearch.unsavedChanges') }}
        </span>
        <q-btn
          :label="t('relays.save')"
          :loading="saving"
          class="diogel-btn-primary"
          @click="saveRelays"
        />
      </div>
    </template>

    <relay-browser-modal v-model="showRelayBrowser" @select="handleRelaySelected" />
  </div>
</template>

<style scoped></style>
