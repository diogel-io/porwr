<script lang="ts" setup>
import { ref, watch, onMounted, computed, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { logService, LogLevel } from '@/services/log-service';
import type { RelayCatalogEntry } from '@/types/relay';
import { listRelayCatalog, refreshRelayCatalog, getRelayDiscoveryStatus } from '@/services/relay-service';
import { filterRelays } from '@/utils/relay-filters';

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'select', relay: RelayCatalogEntry): void;
}>();

const relays = ref<RelayCatalogEntry[]>([]);
const loading = ref(false);
const refreshing = ref(false);
const searchText = ref('');
const searchOnly = ref(false);

const pageSize = ref(10);
const currentPage = ref(1);
const pageSizeOptions = [10, 20, 30, 50, 100];

let statusInterval: number | null = null;

const filteredRelays = computed(() => {
  return filterRelays(relays.value, searchText.value, searchOnly.value);
});

const totalPages = computed(() => {
  return Math.max(1, Math.ceil(filteredRelays.value.length / pageSize.value));
});

const pagedRelays = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredRelays.value.slice(start, end);
});

watch([searchText, searchOnly, pageSize], () => {
  currentPage.value = 1;
});

async function fetchRelays() {
  if (loading.value) return;
  loading.value = true;
  try {
    relays.value = await listRelayCatalog();
  } catch (error) {
    logService.log(LogLevel.ERROR, '[RelayBrowserModal] Failed to fetch relays', { error });
    relays.value = [];
  } finally {
    loading.value = false;
  }
}

async function triggerRefresh(force = false) {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await refreshRelayCatalog(force);
    startPollingStatus();
  } catch (error) {
    logService.log(LogLevel.ERROR, '[RelayBrowserModal] Failed to trigger refresh', { error });
    refreshing.value = false;
  }
}

async function checkStatus() {
  try {
    const status = await getRelayDiscoveryStatus();

    // Determine if we should trigger an automatic refresh
    const isStale = !status || !status.lastGlobalDiscoveryAt ||
      Date.now() - status.lastGlobalDiscoveryAt > 24 * 60 * 60 * 1000; // 24 hours
    const isEmpty = relays.value.length === 0 && !loading.value;

    if ((isStale || isEmpty) && !refreshing.value && (!status || !status.isDiscoveryInProgress)) {
      void triggerRefresh();
      return;
    }

    if (status) {
      refreshing.value = status.isDiscoveryInProgress;
      // Refresh the list if discovery is happening or just finished
      relays.value = await listRelayCatalog();

      if (status.isDiscoveryInProgress) {
        startPollingStatus();
      } else {
        stopPollingStatus();
      }
    } else {
      refreshing.value = false;
      stopPollingStatus();
    }
  } catch (error) {
    logService.log(LogLevel.ERROR, '[RelayBrowserModal] Failed to check status', { error });
    stopPollingStatus();
  } finally {
    // If we're polling status, we've already done the initial list fetch
    // and if we still have no relays but discovery is NOT in progress,
    // we should definitely not be showing the loading spinner.
    // In fact, the loading spinner should always be cleared after the initial fetchRelays
    // but just in case, we can ensure it's false here.
    loading.value = false;
  }
}

function startPollingStatus() {
  if (statusInterval) return;
  statusInterval = window.setInterval(() => {
    void checkStatus();
  }, 2000);
  void checkStatus();
}

function stopPollingStatus() {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
}

onMounted(async () => {
  if (props.modelValue) {
    await fetchRelays();
    await checkStatus(); // Check if discovery is already in progress
  }
});

onBeforeUnmount(() => {
  stopPollingStatus();
});

watch(
  () => props.modelValue,
  async (newVal) => {
    if (newVal) {
      await fetchRelays();
      await checkStatus();
    } else {
      stopPollingStatus();
    }
  },
);

function getDisplayName(relay: RelayCatalogEntry) {
  try {
    return relay.metadata?.name || relay.hostname || relay.url || 'Unknown Relay';
  } catch (e) {
    logService.log(LogLevel.ERROR, '[RelayBrowserModal] Error in getDisplayName', { error: e });
    return relay.url || 'Unknown Relay';
  }
}

function close() {
  emit('update:modelValue', false);
}

function selectRelay(relay: RelayCatalogEntry) {
  emit('select', relay);
  close();
}
</script>

<template>
  <q-dialog :model-value="props.modelValue" @update:model-value="emit('update:modelValue', $event)">
    <q-card style="min-width: 400px; max-height: 80vh" class="column no-wrap">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">{{ t('relays.browser.title') }}</div>
        <q-space />
        <q-btn
          flat
          round
          dense
          icon="refresh"
          :loading="refreshing"
          class="q-mr-sm"
          @click="triggerRefresh(true)"
        >
          <q-tooltip>{{ t('relays.browser.refresh') }}</q-tooltip>
        </q-btn>
        <q-btn v-close-popup flat round dense icon="close" @click="close" />
      </q-card-section>

      <q-card-section class="q-pt-sm">
        <q-input
          v-model="searchText"
          :label="t('relays.browser.search_placeholder')"
          dense
          outlined
          clearable
          class="q-mb-sm"
        >
          <template #append>
            <q-icon name="search" />
          </template>
        </q-input>
        <q-toggle v-model="searchOnly" :label="t('relays.browser.search_only')" dense />
      </q-card-section>

      <q-card-section class="col scroll q-pt-none diogel-scrollbar">
        <div v-if="loading" class="flex justify-center q-my-md">
          <q-spinner color="primary" size="3em" />
          <div class="q-mt-sm full-width text-center">{{ t('relays.browser.loading') }}</div>
        </div>
        <div v-else-if="filteredRelays.length === 0" class="text-center q-pa-lg text-grey">
          <q-icon name="explore" size="4em" class="q-mb-md" />
          <div>{{ t('relays.browser.empty') }}</div>
        </div>
        <div v-else>
          <q-list separator>
            <q-item
              v-for="relay in pagedRelays"
              :key="relay.url"
              clickable
              @click="selectRelay(relay)"
            >
              <q-item-section v-if="relay.metadata?.icon" avatar>
                <q-avatar size="32px">
                  <img :src="relay.metadata.icon" alt="Relay Icon" />
                </q-avatar>
              </q-item-section>
              <q-item-section v-else avatar>
                <q-avatar size="32px" color="primary" text-color="white" icon="hub" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ getDisplayName(relay) }}</q-item-label>
                <q-item-label caption lines="1">{{ relay.url }}</q-item-label>
                <q-item-label v-if="relay.metadata?.description" caption lines="2">
                  {{ relay.metadata.description }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge
                  :color="relay.status === 'online' ? 'positive' : 'grey'"
                  :label="relay.status"
                />
              </q-item-section>
            </q-item>
          </q-list>
        </div>
      </q-card-section>

      <q-card-actions v-if="!loading && filteredRelays.length > 0" class="row items-center justify-between q-px-md q-pb-md">
        <q-select
          v-model="pageSize"
          :options="pageSizeOptions"
          :label="t('relays.browser.results_per_page')"
          dense
          outlined
          options-dense
          emit-value
          map-options
          style="width: 140px"
        />
        <q-pagination
          v-model="currentPage"
          :max="totalPages"
          :max-pages="5"
          boundary-numbers
          direction-links
          color="primary"
          dense
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
</style>
