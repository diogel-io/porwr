<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import useAccountStore from '@/stores/account-store';
import ConversationList from '@/components/dashboard/messaging/ConversationList.vue';
import ConversationView from '@/components/dashboard/messaging/ConversationView.vue';
import { useContactCache } from '@/composables/useContactCache';
import { useDirectMessages } from '@/composables/useDirectMessages';
import { SUPPORT_PUBKEY } from '@/data/support';
import {
  fetchContactProfiles,
  formatContactNpub,
  getContactDisplayName,
} from '@/services/contact-list-service';
import { addSavedPeer, getSavedPeers, removeSavedPeer } from '@/services/messaging-service';
import { buildConversations, conversationMessages } from '@/utils/conversations';
import { searchCachedContacts } from '@/utils/contact-search';
import type { ContactProfile } from '@/types/contact-list';

/**
 * NIP-17 private messages with the account's contacts.
 *
 * Fetching, sending and read state are shared with the Support page through `useDirectMessages`;
 * this page adds the conversation list, contact search and Chats it keeps per account (#258).
 */

const $q = useQuasar();
const { t } = useI18n();
const accountStore = useAccountStore();

const activeKey = computed(() => accountStore.activeAccountOrFirst);
const me = computed(() => activeKey.value?.id ?? '');
const showNoAccount = computed(() => accountStore.hasNoAccounts);

const contactCache = useContactCache(() => activeKey.value?.id);
const contacts = contactCache.contacts;
const contactsLoading = computed(() => contactCache.status.value === 'loading');
/** Profiles of people who wrote but are not contacts, looked up for this page only. */
const requestProfiles = ref<Record<string, ContactProfile>>({});
const profiles = computed<Record<string, ContactProfile>>(() => ({
  ...requestProfiles.value,
  ...contactCache.profiles.value,
}));
/** Contacts added to Chats through search, kept in the vault per account (#258). */
const savedPeers = ref<string[]>([]);
const selectedPeer = ref<string | undefined>();

const {
  messages,
  readState,
  inbox,
  loadFailed,
  pending,
  notReadyPeers,
  poll,
  startPolling,
  loadReadState,
  markRead,
  send: sendTo,
  retry,
  reset,
} = useDirectMessages({
  hasAccount: () => Boolean(activeKey.value),
  onMessages: (fetched) => loadRequestProfiles(fetched.map((message) => message.peer)),
  onRecipientNotReady: (peer) =>
    $q.notify({
      type: 'warning',
      message: t('messaging.view.recipientNotReady', { name: nameOf(peer) }),
    }),
});

const contactPubkeys = computed(() => contacts.value.map((contact) => contact.pubkey));
/**
 * The support conversation lives on the Support page, so it is listed here only when the support
 * account is one of the user's contacts (#228).
 */
const listedMessages = computed(() =>
  contactPubkeys.value.includes(SUPPORT_PUBKEY)
    ? [...messages.value.values()]
    : [...messages.value.values()].filter((message) => message.peer !== SUPPORT_PUBKEY),
);
const conversations = computed(() =>
  buildConversations(listedMessages.value, contactPubkeys.value, savedPeers.value, readState.value),
);
const selectedMessages = computed(() =>
  selectedPeer.value ? conversationMessages(messages.value.values(), selectedPeer.value) : [],
);
const selectedPending = computed(() =>
  pending.value.filter((message) => message.peer === selectedPeer.value),
);

function nameOf(peer: string): string {
  const contact = contacts.value.find((entry) => entry.pubkey === peer) ?? {
    pubkey: peer,
    relayUrl: '',
    petname: '',
  };
  return getContactDisplayName(contact, profiles.value[peer]);
}

function pictureOf(peer: string): string | undefined {
  return profiles.value[peer]?.picture || undefined;
}

function detailOf(peer: string): string {
  const nip05 = profiles.value[peer]?.nip05;
  if (nip05) return nip05;
  const npub = formatContactNpub(peer);
  return `${npub.slice(0, 12)}…${npub.slice(-4)}`;
}

/** Searches the cached contact list only; nothing goes to relays (#258). */
function findContacts(query: string): string[] {
  return searchCachedContacts(query, contacts.value, contactCache.profiles.value);
}

/**
 * Looks up writers who are not contacts. Contacts' profiles come from the cache, which may still be
 * filling, so only pubkeys outside the contact list are fetched here.
 */
async function loadRequestProfiles(pubkeys: string[]) {
  const contactSet = new Set(contactPubkeys.value);
  const missing = [...new Set(pubkeys)].filter(
    (pubkey) => !contactSet.has(pubkey) && !profiles.value[pubkey],
  );
  if (missing.length === 0) return;
  try {
    requestProfiles.value = { ...requestProfiles.value, ...(await fetchContactProfiles(missing)) };
  } catch {
    // Names fall back to npubs; a missing profile never blocks reading or sending.
  }
}

function selectConversation(peer: string) {
  selectedPeer.value = peer;
}

/** Adds a contact found through search to Chats and opens it, ready to send. */
async function startConversation(peer: string) {
  const account = me.value;
  selectedPeer.value = peer;
  if (savedPeers.value.includes(peer)) return;
  savedPeers.value = [...savedPeers.value, peer];
  try {
    const saved = await addSavedPeer(peer);
    if (me.value === account) savedPeers.value = saved;
  } catch {
    if (me.value !== account) return;
    savedPeers.value = savedPeers.value.filter((entry) => entry !== peer);
    if (selectedPeer.value === peer) selectedPeer.value = undefined;
    $q.notify({ type: 'negative', message: t('messaging.list.saveFailed') });
  }
}

/** Takes a contact added through search, and never messaged, off Chats. */
async function removeConversation(peer: string) {
  const account = me.value;
  const before = savedPeers.value;
  savedPeers.value = before.filter((entry) => entry !== peer);
  if (selectedPeer.value === peer) selectedPeer.value = undefined;
  try {
    const saved = await removeSavedPeer(peer);
    if (me.value === account) savedPeers.value = saved;
  } catch {
    if (me.value !== account) return;
    savedPeers.value = before;
    $q.notify({ type: 'negative', message: t('messaging.list.removeFailed') });
  }
}

function send(content: string) {
  const peer = selectedPeer.value;
  if (!peer) return;
  sendTo(peer, content);
}

function resetState() {
  reset();
  requestProfiles.value = {};
  savedPeers.value = [];
  selectedPeer.value = undefined;
}

async function load() {
  if (!activeKey.value) return;
  await Promise.all([
    loadReadState(),
    getSavedPeers()
      .then((peers) => {
        savedPeers.value = peers;
      })
      .catch(() => undefined),
  ]);
  await poll();
}

watch([selectedPeer, selectedMessages], () => {
  if (selectedPeer.value) void markRead(selectedPeer.value);
});

watch(
  () => activeKey.value?.id,
  (id, previous) => {
    if (previous !== undefined && id !== previous) {
      resetState();
      void load();
    }
  },
);

onMounted(async () => {
  await accountStore.getKeys();
  if (!accountStore.activeKey && activeKey.value) {
    await accountStore.setActiveKey(activeKey.value.alias);
  }
  await load();
  startPolling();
});
</script>

<template>
  <q-page class="dashboard-page messaging-page">
    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('messaging.title') }}</h1>
      <p class="dashboard-hero-caption">{{ t('messaging.dashboardCaption') }}</p>
    </section>

    <div v-if="showNoAccount" class="text-center q-pa-xl">
      <div class="text-h6 text-grey-7">{{ t('account.noAccounts') }}</div>
      <p class="text-grey-6">{{ t('account.noAccountDesc') }}</p>
    </div>

    <template v-else>
      <q-banner v-if="inbox === 'none'" class="q-mb-md" rounded data-testid="no-inbox">
        {{ t('messaging.noInbox') }}
        <template #action>
          <q-btn flat :label="t('messaging.noInboxAction')" :to="{ name: 'relays' }" />
        </template>
      </q-banner>
      <q-banner v-if="loadFailed" class="q-mb-md" rounded data-testid="load-failed">
        {{ t('messaging.loadError') }}
      </q-banner>

      <q-card class="dashboard-card messaging-page__card">
        <div class="row no-wrap messaging-page__panes">
          <div class="col-12 col-md-4 messaging-page__list">
            <ConversationList
              :conversations="conversations"
              :selected-peer="selectedPeer"
              :name-of="nameOf"
              :picture-of="pictureOf"
              :detail-of="detailOf"
              :find-contacts="findContacts"
              :loading="contactsLoading"
              @select="selectConversation"
              @start="startConversation"
              @remove="removeConversation"
            />
          </div>
          <div class="col messaging-page__view">
            <ConversationView
              v-if="selectedPeer"
              :peer-name="nameOf(selectedPeer)"
              :messages="selectedMessages"
              :pending="selectedPending"
              :me="me"
              :recipient-not-ready="notReadyPeers.has(selectedPeer)"
              :disabled="inbox === 'unknown'"
              @send="send"
              @retry="retry"
            />
            <div v-else class="flex flex-center full-height text-grey q-pa-xl">
              {{ t('messaging.selectPrompt') }}
            </div>
          </div>
        </div>
      </q-card>
    </template>
  </q-page>
</template>

<style scoped>
.messaging-page {
  width: 100%;
}

.messaging-page__card {
  overflow: hidden;
}

.messaging-page__panes {
  min-height: 24rem;
  height: calc(100vh - 19rem);
}

.messaging-page__list {
  overflow-y: auto;
  border-right: 1px solid rgba(127, 127, 127, 0.2);
}

.messaging-page__view {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

@media (max-width: 1023px) {
  .messaging-page__panes {
    flex-wrap: wrap;
    height: auto;
  }

  .messaging-page__list {
    border-right: none;
    border-bottom: 1px solid rgba(127, 127, 127, 0.2);
    max-height: 16rem;
  }
}
</style>
