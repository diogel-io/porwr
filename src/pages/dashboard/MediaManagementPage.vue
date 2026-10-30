<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import useAccountStore from '@/stores/account-store';
import useSettingsStore from '@/stores/settings-store';
import { normalizeBlossomServer, validateBlossomServerInput } from '@/services/blossom-server';
import {
  buildServerListTags,
  fetchServerList,
  publishServerList,
  type BlossomServerListLookup,
} from '@/services/blossom-server-list';

const $q = useQuasar();
const { t } = useI18n();
const accountStore = useAccountStore();
const settingsStore = useSettingsStore();

const activeStoredKey = computed(() => accountStore.activeAccountOrFirst);
const showNoAccount = computed(() => accountStore.hasNoAccounts);

/**
 * The account's kind 10063 as last read (porwr#417). `unreachable` means the list shown may not be
 * the account's, and saving would replace whatever is published.
 */
const listStatus = ref<'loading' | 'found' | 'not-found' | 'unreachable'>('loading');
/** The servers of the account's published list, primary first. */
const publishedServers = ref<string[]>([]);
const serverInput = ref('');
const saving = ref(false);

const serverError = computed(() => {
  const result = validateBlossomServerInput(serverInput.value);
  return result.valid ? '' : (result.error ?? '');
});

// Nothing to save when the field still shows the published primary.
const canSave = computed(
  () =>
    !saving.value &&
    listStatus.value !== 'loading' &&
    serverError.value === '' &&
    !(listStatus.value === 'found' && serverInput.value.trim() === publishedServers.value[0]),
);

/** The vault's Blossom setting, shown for an account with no list of its own. */
function vaultDefault(): string {
  return normalizeBlossomServer(settingsStore.blossomServer).url ?? settingsStore.blossomServer;
}

/** The account whose list the field shows, or is loading. */
let loadedPubkey: string | undefined;

async function loadServerList(pubkey: string): Promise<void> {
  loadedPubkey = pubkey;
  listStatus.value = 'loading';
  let lookup: BlossomServerListLookup;
  try {
    await settingsStore.getSettings();
    lookup = await fetchServerList(pubkey);
  } catch (error) {
    // Shown as unreachable, so the page never stays disabled and saving still asks first.
    console.error('Error loading Blossom server list:', error);
    lookup = { status: 'unreachable' };
  }
  // Another account was chosen while this one was read.
  if (activeStoredKey.value?.id !== pubkey) {
    // Lets the watcher load this account again if it is chosen once more.
    if (loadedPubkey === pubkey) loadedPubkey = undefined;
    return;
  }

  if (lookup.status === 'found') {
    publishedServers.value = lookup.servers;
    serverInput.value = lookup.servers[0] ?? '';
  } else {
    publishedServers.value = [];
    serverInput.value = vaultDefault();
  }
  listStatus.value = lookup.status;
}

function confirmReplace(): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = $q.dialog({
      title: t('mediaManagement.replaceTitle'),
      message: t('mediaManagement.replaceBody'),
      ok: { label: t('mediaManagement.saveAnyway'), color: 'warning', noCaps: true },
      cancel: { label: t('mediaManagement.cancel'), flat: true, noCaps: true },
      persistent: true,
    });
    dialog.onOk(() => resolve(true));
    dialog.onCancel(() => resolve(false));
  });
}

async function saveServer(): Promise<void> {
  const account = activeStoredKey.value;
  const server = validateBlossomServerInput(serverInput.value).url;
  if (!account || !server || !canSave.value) return;
  if (listStatus.value === 'unreachable' && !(await confirmReplace())) return;
  // The dialog can stay open while another account is chosen; its list must not be published here.
  if (activeStoredKey.value?.id !== account.id) return;

  saving.value = true;
  try {
    const tags = buildServerListTags(server, publishedServers.value);
    await publishServerList(account.id, tags);
    // Another account may have been chosen while this one was publishing.
    if (activeStoredKey.value?.id === account.id) {
      publishedServers.value = tags.map((tag) => tag[1] ?? '');
      serverInput.value = server;
      listStatus.value = 'found';
    }
    $q.notify({ type: 'positive', message: t('mediaManagement.saveSuccess') });
  } catch (error) {
    console.error('Error saving Blossom server list:', error);
    $q.notify({ type: 'negative', message: t('mediaManagement.saveError') });
  } finally {
    saving.value = false;
  }
}

watch(
  () => activeStoredKey.value?.id,
  (pubkey) => {
    if (pubkey && pubkey !== loadedPubkey) void loadServerList(pubkey);
  },
);

onMounted(async () => {
  await accountStore.getKeys();
  if (!accountStore.activeKey && activeStoredKey.value) {
    await accountStore.setActiveKey(activeStoredKey.value.alias);
  }
  if (activeStoredKey.value && activeStoredKey.value.id !== loadedPubkey) {
    await loadServerList(activeStoredKey.value.id);
  }
});
</script>

<template>
  <q-page class="dashboard-page media-management-page">
    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('mediaManagement.title') }}</h1>
      <p class="dashboard-hero-caption">{{ t('mediaManagement.dashboardCaption') }}</p>
    </section>

    <q-card class="dashboard-card media-management-page__card" data-testid="blossom-server-card">
      <q-card-section v-if="activeStoredKey">
        <h2 class="text-subtitle1 q-mb-md">{{ t('profile.blossomServer') }}</h2>
        <q-list>
          <q-item>
            <q-item-section>
              <q-item-label>{{ t('profile.blossomServer') }}</q-item-label>
              <q-item-label caption>{{ t('profile.blossomServerCaption') }}</q-item-label>
              <div class="row q-col-gutter-sm items-start q-mt-sm">
                <div class="col-grow">
                  <q-input
                    v-model="serverInput"
                    dense
                    outlined
                    :aria-label="t('profile.blossomServer')"
                    :disable="listStatus === 'loading'"
                    :error="serverError !== ''"
                    :error-message="serverError"
                    @keyup.enter="saveServer"
                  />
                </div>
                <div class="col-auto">
                  <q-btn
                    class="diogel-btn-primary"
                    :label="t('mediaManagement.save')"
                    :loading="saving"
                    :disable="!canSave"
                    no-caps
                    @click="saveServer"
                  />
                </div>
              </div>
              <q-item-label
                v-if="listStatus === 'not-found'"
                caption
                data-testid="blossom-server-not-published"
              >
                {{ t('mediaManagement.notPublished') }}
              </q-item-label>
              <q-banner
                v-else-if="listStatus === 'unreachable'"
                class="q-mt-sm"
                dense
                rounded
                data-testid="blossom-server-load-error"
              >
                {{ t('mediaManagement.loadError') }}
              </q-banner>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>

      <div v-else-if="showNoAccount" class="text-center q-pa-xl">
        <q-icon color="grey-5" name="account_circle" size="4em" />
        <div class="text-h6 text-grey-7 q-mt-md">{{ t('account.noAccounts') }}</div>
        <p class="text-grey-6">{{ t('account.noAccountDesc') }}</p>
        <q-btn
          class="q-mt-md diogel-btn-primary"
          :label="t('account.create')"
          :to="{ name: 'add-new-key' }"
        />
      </div>

      <!-- Not yet read from the vault, which is not the same as holding no accounts (#211). -->
      <div v-else class="text-center q-pa-xl" role="status">
        <q-spinner color="grey-5" size="3em" />
        <div class="text-h6 text-grey-7 q-mt-md">{{ t('account.loading') }}</div>
      </div>
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
