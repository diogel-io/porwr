<script lang="ts" setup>
import { onMounted, ref, watch, computed } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { normalizeRelayUrl } from '@/services/relay-url';
import type { NostrRelay } from '@/types';
import type { AccountSummary } from '@/types/accounts';
import type { RelayCatalogEntry } from '@/types/relay';
import { SimplePool } from 'nostr-tools';
import { signAsAccount } from '@/services/account-signing-client';
import useSettingsStore from '@/stores/settings-store';
import RelayBrowserModal from '@/components/dashboard/RelayBrowserModal.vue';

defineOptions({ name: 'RelayEditor' });

const props = defineProps<{
  storedKey: AccountSummary;
}>();

const $q = useQuasar();
const $t = useI18n().t;
const settingsStore = useSettingsStore();

const relays = ref<NostrRelay[]>([]);
const loading = ref(false);
const saving = ref(false);

const fallbackRelays = computed(() => settingsStore.fallbackRelays);

const newRelayUrl = ref('');
const newRelayWrite = ref(false);
const showRelayBrowser = ref(false);
/**
 * The account's relay list could not be read, so the list shown is not known to be its current one,
 * and saving would replace whatever is published (#142).
 */
const loadFailed = ref(false);

async function fetchRelayList() {
  relays.value = [];
  loadFailed.value = false;
  // `pool.get` over no relays never settles. With no usable fallback relay (#142) there is nothing
  // to read: the editor stays usable, but says the list shown may not be the account's.
  if (fallbackRelays.value.length === 0) {
    loadFailed.value = true;
    loading.value = false;
    return;
  }
  loading.value = true;
  const pool = new SimplePool();
  try {
    const event = await pool.get(fallbackRelays.value, {
      kinds: [10002],
      authors: [props.storedKey.id],
    });

    if (event) {
      relays.value = event.tags
        .filter((tag) => tag[0] === 'r' && !!tag[1])
        .map((tag) => {
          const url = tag[1] as string;
          const marker = tag[2];
          return {
            url,
            read: !marker || marker === 'read',
            write: !marker || marker === 'write',
          };
        });
    }
  } catch (error) {
    loadFailed.value = true;
    console.error('Error fetching relay list:', error);
    $q.notify({
      type: 'negative',
      message: String($t('relays.fetchError')),
    });
  } finally {
    pool.close(fallbackRelays.value);
    loading.value = false;
  }
}

function addRelay() {
  const result = normalizeRelayUrl(newRelayUrl.value);
  if (!result.valid || !result.url) {
    if (result.error && result.error !== 'URL cannot be empty') {
      $q.notify({
        type: 'negative',
        message: String($t('relays.invalidUrl')),
      });
    }
    return;
  }

  const url = result.url;
  if (relays.value.some((r) => r.url === url)) {
    newRelayUrl.value = '';
    return;
  }

  relays.value.push({
    url,
    read: true,
    write: newRelayWrite.value,
  });

  newRelayUrl.value = '';
  newRelayWrite.value = false;
}

function removeRelay(index: number) {
  relays.value.splice(index, 1);
}

function handleRelaySelected(relay: RelayCatalogEntry) {
  newRelayUrl.value = relay.url;
  newRelayWrite.value = false;
}

function publishTargets(): string[] {
  const writeRelays = relays.value
    .filter((relay) => relay.write)
    .map((relay) => normalizeRelayUrl(relay.url))
    .flatMap((result) => (result.valid && result.url ? [result.url] : []));
  return [...new Set([...fallbackRelays.value, ...writeRelays])];
}

async function saveRelayList() {
  saving.value = true;
  const pool = new SimplePool();
  let targets: string[] = [];
  try {
    const tags = relays.value.map((r) => {
      const tag = ['r', r.url];
      if (r.read && !r.write) tag.push('read');
      else if (!r.read && r.write) tag.push('write');
      return tag;
    });

    // Signed in the background, which holds the key (#240).
    const event = await signAsAccount(props.storedKey.id, {
      kind: 10002,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    });

    // NIP-65: the list also goes to the write relays it names, so it can be saved even when no
    // fallback relay is usable (#142). Only relays Porwr may connect to are used.
    targets = publishTargets();
    await Promise.any(pool.publish(targets, event));

    $q.notify({
      type: 'positive',
      message: String($t('relays.saveSuccess')),
    });
  } catch (error) {
    console.error('Error saving relay list:', error);
    $q.notify({
      type: 'negative',
      message: String($t('relays.saveError')),
    });
  } finally {
    pool.close(targets);
    saving.value = false;
  }
}

onMounted(async () => {
  await settingsStore.getSettings();
  void fetchRelayList();
});

watch(
  () => props.storedKey.id,
  () => {
    void fetchRelayList();
  },
);
</script>

<template>
  <div class="q-pa-md">
    <div class="text-h6 q-mb-md">{{ $t('relays.title') }}</div>

    <div v-if="loading" class="flex justify-center q-my-md">
      <q-spinner color="primary" size="3em" />
    </div>

    <template v-else>
      <q-banner v-if="loadFailed" class="q-mb-md" dense rounded data-testid="relay-list-load-error">
        {{ $t('relays.loadError') }}
      </q-banner>
      <div class="q-mb-md">
        <div class="row q-col-gutter-sm items-center">
          <div class="col-grow">
            <q-input
              v-model="newRelayUrl"
              :label="$t('relays.url')"
              dense
              outlined
              @keyup.enter="addRelay"
            >
              <template #append>
                <q-btn flat round dense icon="explore" @click="showRelayBrowser = true">
                  <q-tooltip>{{ $t('relays.browse') }}</q-tooltip>
                </q-btn>
              </template>
            </q-input>
          </div>
          <div class="col-auto">
            <q-checkbox v-model="newRelayWrite" :label="$t('relays.write')" dense />
          </div>
          <div class="col-auto">
            <q-btn class="diogel-btn-primary" icon="add" round @click="addRelay" />
          </div>
        </div>
      </div>

      <q-list v-if="relays.length > 0" bordered separator>
        <q-item v-for="(relay, index) in relays" :key="relay.url">
          <q-item-section>
            <q-item-label>{{ relay.url }}</q-item-label>
            <q-item-label caption>
              <q-badge
                v-if="relay.read"
                color="blue-2"
                :label="$t('relays.read')"
                text-color="blue-9"
              />
              <q-badge
                v-if="relay.write"
                class="q-ml-xs"
                color="green-2"
                :label="$t('relays.write')"
                text-color="green-9"
              />
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="row q-gutter-xs">
              <q-btn
                class="diogel-btn-ghost"
                icon="delete"
                round
                size="sm"
                @click="removeRelay(index)"
              />
            </div>
          </q-item-section>
        </q-item>
      </q-list>

      <div v-else class="text-center q-pa-md text-grey">
        {{ $t('relays.noRelays') }}
      </div>

      <div class="q-mt-md text-caption text-grey">
        {{ $t('relays.recommendedSize') }}
      </div>

      <div class="row justify-end q-mt-lg">
        <q-btn
          :label="$t('relays.save')"
          :loading="saving"
          class="diogel-btn-primary"
          @click="saveRelayList"
        />
      </div>
    </template>

    <relay-browser-modal v-model="showRelayBrowser" @select="handleRelaySelected" />
  </div>
</template>

<style scoped></style>
