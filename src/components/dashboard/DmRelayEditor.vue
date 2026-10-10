<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { normalizeRelayUrl } from '@/services/relay-url';
import { getDmRelays, publishDmRelays } from '@/services/messaging-service';
import type { AccountSummary } from '@/types/accounts';

defineOptions({ name: 'DmRelayEditor' });

/**
 * The account's NIP-17 inbox: the relays other people deliver private messages to (kind 10050).
 *
 * Signing happens in the background; this component only edits a list of URLs.
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

const overRecommended = computed(() => relays.value.length > RECOMMENDED_MAX);

async function loadDmRelays() {
  loading.value = true;
  loadFailed.value = false;
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

async function saveDmRelays() {
  saving.value = true;
  try {
    const result = await publishDmRelays(relays.value);
    relays.value = [...result.relays];
    neverPublished.value = false;
    $q.notify({
      type: 'positive',
      message: t('relays.dmRelays.saveSuccess', { count: result.accepted.length }),
    });
  } catch {
    $q.notify({ type: 'negative', message: t('relays.dmRelays.saveError') });
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadDmRelays();
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
    <p class="text-caption text-grey-7 q-mb-md">{{ t('relays.dmRelays.caption') }}</p>

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
          />
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

      <div class="row justify-end q-mt-lg">
        <q-btn
          :label="t('relays.dmRelays.save')"
          :loading="saving"
          class="diogel-btn-primary"
          @click="saveDmRelays"
        />
      </div>
    </template>
  </div>
</template>

<style scoped></style>
