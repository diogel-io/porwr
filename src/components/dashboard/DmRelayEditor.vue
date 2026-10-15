<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { normalizeRelayUrl } from '@/services/relay-url';
import { checkDmRelays, getDmRelays, publishDmRelays } from '@/services/messaging-service';
import { summariseDmRelayChecks } from '@/services/dm-relay-checks';
import type { DmRelayCheck } from '@/types/messaging';
import type { AccountSummary } from '@/types/accounts';
import type { RelayCatalogEntry } from '@/types/relay';
import RelayBrowserModal from '@/components/dashboard/RelayBrowserModal.vue';

defineOptions({ name: 'DmRelayEditor' });

/**
 * The account's NIP-17 inbox: the relays other people deliver private messages to (kind 10050).
 *
 * Signing happens in the background; this component only edits a list of URLs. Saving first checks
 * that each relay keeps gift wraps, and won't publish a list where none do (#277).
 */
const props = defineProps<{
  storedKey: AccountSummary;
}>();

/** NIP-17 asks clients to guide users towards small lists. */
const RECOMMENDED_MAX = 3;

const $q = useQuasar();
const { t } = useI18n();

const relays = ref<string[]>([]);
const newRelayUrl = ref('');
const loading = ref(false);
const saving = ref(false);
const loadFailed = ref(false);
const neverPublished = ref(false);
const showRelayBrowser = ref(false);
const checking = ref(false);
/** The last check of each relay, by URL. */
const checks = ref<Record<string, DmRelayCheck>>({});
/** Relays that stopped the last save because none of the list keeps messages. */
const blockedBy = ref<string[]>([]);

const overRecommended = computed(() => relays.value.length > RECOMMENDED_MAX);

async function loadDmRelays() {
  loading.value = true;
  loadFailed.value = false;
  checks.value = {};
  blockedBy.value = [];
  try {
    const list = await getDmRelays();
    relays.value = [...list.relays];
    neverPublished.value = list.updatedAt === null;
  } catch {
    relays.value = [];
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
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

/** Checks every relay, treating a check that fails as one that couldn't check any of them. */
async function checkRelays(list: string[]): Promise<DmRelayCheck[]> {
  checking.value = true;
  try {
    return [...(await checkDmRelays(list)).checks];
  } catch (error) {
    console.error('Error checking direct message relays:', error);
    $q.notify({ type: 'warning', message: t('relays.dmRelays.checkFailed') });
    return list.map((url) => ({ url, status: 'unchecked' }));
  } finally {
    checking.value = false;
  }
}

function confirmDropping(dropping: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = $q.dialog({
      title: t('relays.dmRelays.someDropTitle'),
      message: t('relays.dmRelays.someDropBody', { relays: dropping.join(', ') }),
      ok: { label: t('relays.dmRelays.publishAnyway'), color: 'warning', noCaps: true },
      cancel: { label: t('relays.dmRelays.cancel'), flat: true, noCaps: true },
      persistent: true,
    });
    dialog.onOk(() => resolve(true));
    dialog.onCancel(() => resolve(false));
  });
}

async function saveDmRelays() {
  saving.value = true;
  blockedBy.value = [];
  try {
    const list = [...relays.value];
    if (list.length > 0) {
      const results = await checkRelays(list);
      checks.value = Object.fromEntries(results.map((check) => [check.url, check]));
      const summary = summariseDmRelayChecks(results);
      if (summary.allDrop) {
        blockedBy.value = summary.dropping;
        return;
      }
      if (summary.dropping.length > 0 && !(await confirmDropping(summary.dropping))) return;
    }
    await publish(list);
  } finally {
    saving.value = false;
  }
}

async function publish(list: string[]) {
  try {
    const result = await publishDmRelays(list);
    relays.value = [...result.relays];
    neverPublished.value = false;
    $q.notify({
      type: 'positive',
      message: t('relays.dmRelays.saveSuccess', { count: result.accepted.length }),
    });
  } catch (error) {
    console.error('Error publishing direct message relays:', error);
    $q.notify({ type: 'negative', message: t('relays.dmRelays.saveError') });
  }
}

const STATUS_COLOR = { keeps: 'positive', drops: 'negative', unchecked: 'grey-6' } as const;

onMounted(() => {
  void loadDmRelays();
});

watch(relays, () => {
  blockedBy.value = [];
});

watch(
  () => props.storedKey.id,
  () => {
    void loadDmRelays();
  },
);
</script>

<template>
  <div class="q-pa-md dm-relay-editor">
    <div class="text-h6">{{ t('relays.dmRelays.title') }}</div>
    <p class="text-caption text-grey-7 q-mb-sm">{{ t('relays.dmRelays.caption') }}</p>
    <p class="text-caption text-grey-7 q-mb-md" data-testid="dm-relays-keeps-messages">
      {{ t('relays.dmRelays.keepsMessages') }}
    </p>

    <div v-if="loading" class="flex justify-center q-my-md" role="status">
      <q-spinner color="primary" size="3em" />
    </div>

    <template v-else>
      <q-banner v-if="loadFailed" class="q-mb-md" dense rounded>
        {{ t('relays.dmRelays.loadError') }}
      </q-banner>
      <q-banner v-else-if="neverPublished" class="q-mb-md" dense rounded>
        {{ t('relays.dmRelays.notPublished') }}
      </q-banner>

      <div class="row q-col-gutter-sm items-center q-mb-md">
        <div class="col-grow">
          <q-input
            v-model="newRelayUrl"
            :label="t('relays.dmRelays.url')"
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
            :aria-label="t('relays.dmRelays.add')"
            @click="addRelay"
          />
        </div>
      </div>

      <q-list v-if="relays.length > 0" bordered separator>
        <q-item v-for="(relay, index) in relays" :key="relay">
          <q-item-section>
            <q-item-label>{{ relay }}</q-item-label>
          </q-item-section>
          <q-item-section v-if="checks[relay]" side>
            <q-chip
              :color="STATUS_COLOR[checks[relay].status]"
              text-color="white"
              dense
              :data-testid="`dm-relay-status-${checks[relay].status}`"
              :title="checks[relay].reason"
            >
              {{ t(`relays.dmRelays.status.${checks[relay].status}`) }}
            </q-chip>
          </q-item-section>
          <q-item-section side>
            <q-btn
              class="diogel-btn-ghost"
              icon="delete"
              round
              size="sm"
              :aria-label="t('relays.dmRelays.remove', { url: relay })"
              @click="removeRelay(index)"
            />
          </q-item-section>
        </q-item>
      </q-list>

      <div v-else class="text-center q-pa-md text-grey">
        {{ t('relays.dmRelays.empty') }}
      </div>

      <div
        class="q-mt-md text-caption"
        :class="overRecommended ? 'text-warning' : 'text-grey'"
        data-testid="dm-relays-guidance"
      >
        {{ overRecommended ? t('relays.dmRelays.tooMany') : t('relays.dmRelays.recommendedSize') }}
      </div>

      <q-banner
        v-if="blockedBy.length > 0"
        class="q-mt-md bg-negative text-white"
        dense
        rounded
        data-testid="dm-relays-all-drop"
      >
        {{ t('relays.dmRelays.allDrop', { relays: blockedBy.join(', ') }) }}
      </q-banner>

      <div
        v-if="checking"
        class="q-mt-md text-caption text-grey"
        role="status"
        data-testid="dm-relays-checking"
      >
        {{ t('relays.dmRelays.checking') }}
      </div>

      <div class="row justify-end q-mt-lg">
        <q-btn
          :label="t('relays.save')"
          :loading="saving"
          class="diogel-btn-primary"
          @click="saveDmRelays"
        />
      </div>
    </template>

    <relay-browser-modal v-model="showRelayBrowser" @select="handleRelaySelected" />
  </div>
</template>

<style scoped></style>
