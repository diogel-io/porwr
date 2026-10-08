<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import useAccountStore from '@/stores/account-store';
import ConversationList from '@/components/dashboard/messaging/ConversationList.vue';
import ConversationView from '@/components/dashboard/messaging/ConversationView.vue';
import { fetchContactList, fetchContactProfiles, getContactDisplayName } from '@/services/contact-list-service';
import { fetchMessages, getReadState, markConversationRead, sendMessage } from '@/services/messaging-service';
import { buildConversations, conversationMessages, mergeMessages, newestFrom } from '@/utils/conversations';
import type { ContactProfile, Nip02Contact } from '@/types/contact-list';
import type { DirectMessage, MessagingReadState, PendingMessage } from '@/types/messaging';

/**
 * NIP-17 private messages with the account's contacts.
 *
 * Messages are fetched only while this page is open and visible: there is no background listening,
 * badge or notification. Everything cryptographic happens in the background; this page sees
 * decrypted text and outcomes only.
 */

/** How often to look for new messages while the page is visible. */
const POLL_INTERVAL_MS = 15_000;
/**
 * Overlap between fetches. A peer's clock can run behind ours, so the next fetch looks back a little
 * further than the newest message held; duplicates are dropped by id.
 */
const FETCH_OVERLAP_S = 10 * 60;

const $q = useQuasar();
const { t } = useI18n();
const accountStore = useAccountStore();

const activeKey = computed(() => accountStore.activeAccountOrFirst);
const me = computed(() => activeKey.value?.id ?? '');
const showNoAccount = computed(() => accountStore.hasNoAccounts);

const contacts = ref<Nip02Contact[]>([]);
const profiles = ref<Record<string, ContactProfile>>({});
const messages = shallowRef<Map<string, DirectMessage>>(new Map());
const readState = ref<MessagingReadState>({});
const inbox = ref<'unknown' | 'ready' | 'none'>('unknown');
const loadFailed = ref(false);
const selectedPeer = ref<string | undefined>();
const pending = ref<PendingMessage[]>([]);
const notReadyPeers = ref(new Set<string>());

let newestFetched: number | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let polling = false;

const contactPubkeys = computed(() => contacts.value.map((contact) => contact.pubkey));
const conversations = computed(() => buildConversations(messages.value.values(), contactPubkeys.value, readState.value));
const selectedMessages = computed(() =>
  selectedPeer.value ? conversationMessages(messages.value.values(), selectedPeer.value) : [],
);
const selectedPending = computed(() => pending.value.filter((message) => message.peer === selectedPeer.value));

function nameOf(peer: string): string {
  const contact = contacts.value.find((entry) => entry.pubkey === peer) ?? { pubkey: peer, relayUrl: '', petname: '' };
  return getContactDisplayName(contact, profiles.value[peer]);
}

function pictureOf(peer: string): string | undefined {
  return profiles.value[peer]?.picture || undefined;
}

async function loadProfiles(pubkeys: string[]) {
  const missing = [...new Set(pubkeys)].filter((pubkey) => !profiles.value[pubkey]);
  if (missing.length === 0) return;
  try {
    profiles.value = { ...profiles.value, ...(await fetchContactProfiles(missing)) };
  } catch {
    // Names fall back to npubs; a missing profile never blocks reading or sending.
  }
}

async function loadContacts() {
  if (!activeKey.value) return;
  try {
    contacts.value = (await fetchContactList(activeKey.value)).contacts;
  } catch {
    contacts.value = [];
  }
}

async function poll() {
  if (polling || !activeKey.value) return;
  polling = true;
  try {
    const since = newestFetched === undefined ? undefined : newestFetched - FETCH_OVERLAP_S;
    const result = await fetchMessages(since);
    inbox.value = result.inbox;
    loadFailed.value = false;
    if (result.messages.length > 0) {
      messages.value = mergeMessages(messages.value, result.messages);
      newestFetched = Math.max(newestFetched ?? 0, ...result.messages.map((message) => message.created_at));
      await loadProfiles(result.messages.map((message) => message.peer));
    }
  } catch {
    loadFailed.value = true;
  } finally {
    polling = false;
  }
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') void poll();
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void poll();
  }, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function stopPolling() {
  if (pollTimer !== undefined) clearInterval(pollTimer);
  pollTimer = undefined;
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

async function markSelectedRead() {
  const peer = selectedPeer.value;
  if (!peer) return;
  const newest = newestFrom(selectedMessages.value, peer);
  if (newest === undefined || newest <= (readState.value[peer] ?? 0)) return;
  readState.value = { ...readState.value, [peer]: newest };
  try {
    readState.value = await markConversationRead(peer, newest);
  } catch {
    // Read state is a convenience; the next open tries again.
  }
}

function selectConversation(peer: string) {
  selectedPeer.value = peer;
}

async function deliver(message: PendingMessage) {
  try {
    const result = await sendMessage({
      clientMessageId: message.clientMessageId,
      recipient: message.peer,
      content: message.content,
    });
    pending.value = pending.value.filter((entry) => entry.clientMessageId !== message.clientMessageId);
    if (result.status === 'sent') {
      messages.value = mergeMessages(messages.value, [result.message]);
    } else {
      notReadyPeers.value = new Set([...notReadyPeers.value, message.peer]);
      $q.notify({ type: 'warning', message: t('messaging.view.recipientNotReady', { name: nameOf(message.peer) }) });
    }
  } catch {
    pending.value = pending.value.map((entry) =>
      entry.clientMessageId === message.clientMessageId ? { ...entry, status: 'failed' } : entry,
    );
  }
}

function send(content: string) {
  const peer = selectedPeer.value;
  if (!peer) return;
  const message: PendingMessage = { clientMessageId: crypto.randomUUID(), peer, content, status: 'sending' };
  pending.value = [...pending.value, message];
  void deliver(message);
}

function retry(clientMessageId: string) {
  const message = pending.value.find((entry) => entry.clientMessageId === clientMessageId);
  if (!message) return;
  const again: PendingMessage = { ...message, status: 'sending' };
  pending.value = pending.value.map((entry) => (entry.clientMessageId === clientMessageId ? again : entry));
  void deliver(again);
}

function resetState() {
  contacts.value = [];
  profiles.value = {};
  messages.value = new Map();
  readState.value = {};
  inbox.value = 'unknown';
  selectedPeer.value = undefined;
  pending.value = [];
  notReadyPeers.value = new Set();
  newestFetched = undefined;
}

async function load() {
  if (!activeKey.value) return;
  await Promise.all([
    loadContacts(),
    getReadState()
      .then((state) => {
        readState.value = state;
      })
      .catch(() => undefined),
  ]);
  void loadProfiles(contactPubkeys.value);
  await poll();
}

watch([selectedPeer, selectedMessages], () => {
  void markSelectedRead();
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

onBeforeUnmount(() => {
  stopPolling();
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
              @select="selectConversation"
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
