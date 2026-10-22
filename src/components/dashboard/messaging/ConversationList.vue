<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConversationSummary } from '@/utils/conversations';
import RemoteImage from '@/components/shared/RemoteImage.vue';

defineOptions({ name: 'ConversationList' });

/**
 * The Messaging page's left panel, as Concept C (#258): Chats and Requests tabs, each with its unread
 * total. Chats lists conversations and searches the contact list to start new ones; Requests lists
 * people outside the contact list who wrote first.
 */
const props = defineProps<{
  conversations: ConversationSummary[];
  selectedPeer?: string | undefined;
  nameOf: (peer: string) => string;
  pictureOf: (peer: string) => string | undefined;
  /** A NIP-05 or short npub to tell search results apart. */
  detailOf: (peer: string) => string;
  /** Contacts matching a query, best first, from the cached contact list. */
  findContacts: (query: string) => string[];
  /** Contacts have not arrived yet: an empty list here would wrongly say there are none (#257). */
  loading?: boolean;
}>();

const emit = defineEmits<{
  select: [peer: string];
  start: [peer: string];
  remove: [peer: string];
}>();

const { t } = useI18n();

type Tab = 'chats' | 'requests';
const tab = ref<Tab>('chats');
const query = ref<string | null>('');

const chats = computed(() => props.conversations.filter((conversation) => !conversation.isRequest));
const requests = computed(() =>
  props.conversations.filter((conversation) => conversation.isRequest),
);

const unreadIn = (list: ConversationSummary[]) =>
  list.reduce((total, conversation) => total + conversation.unread, 0);
const chatsUnread = computed(() => unreadIn(chats.value));
const requestsUnread = computed(() => unreadIn(requests.value));

// `clearable` sets the model to null.
const searchText = computed(() => (query.value ?? '').trim());
const searching = computed(() => searchText.value.length > 0);
const matches = computed(() => (searching.value ? props.findContacts(searchText.value) : []));

/** While searching, chats whose contact matches or whose name contains the query. */
const visibleChats = computed(() => {
  if (!searching.value) return chats.value;
  const matched = new Set(matches.value);
  const needle = searchText.value.toLowerCase();
  return chats.value.filter(
    (conversation) =>
      matched.has(conversation.peer) ||
      props.nameOf(conversation.peer).toLowerCase().includes(needle),
  );
});

/** Matching contacts with no conversation yet. */
const startable = computed(() => {
  const listed = new Set(props.conversations.map((conversation) => conversation.peer));
  return matches.value.filter((peer) => !listed.has(peer));
});

const showLoading = computed(() => Boolean(props.loading) && props.conversations.length === 0);

function preview(conversation: ConversationSummary): string {
  const message = conversation.lastMessage;
  if (!message) return t('messaging.list.noMessages');
  return message.pubkey === conversation.peer
    ? message.content
    : t('messaging.list.fromMe', { content: message.content });
}

function start(peer: string) {
  query.value = '';
  emit('start', peer);
}

// Replying to a request makes it a chat; follow it there rather than leave the row vanishing from view.
watch(
  () =>
    Boolean(props.selectedPeer) &&
    chats.value.some((conversation) => conversation.peer === props.selectedPeer),
  (selectedIsChat) => {
    if (selectedIsChat && tab.value === 'requests') tab.value = 'chats';
  },
);
</script>

<template>
  <nav class="conversation-list column no-wrap" :aria-label="t('messaging.list.label')">
    <q-tabs
      v-model="tab"
      dense
      no-caps
      align="justify"
      active-color="primary"
      indicator-color="primary"
      class="conversation-list__tabs"
    >
      <q-tab name="chats" data-testid="conversation-tab-chats" @click="tab = 'chats'">
        <span class="conversation-list__tab-label">
          {{ t('messaging.list.chats') }}
          <q-badge
            v-if="chatsUnread > 0"
            color="primary"
            rounded
            :label="chatsUnread"
            :aria-label="t('messaging.list.unread', { count: chatsUnread })"
            class="conversation-list__tab-unread"
          />
        </span>
      </q-tab>
      <q-tab name="requests" data-testid="conversation-tab-requests" @click="tab = 'requests'">
        <span class="conversation-list__tab-label">
          {{ t('messaging.list.requests') }}
          <q-badge
            v-if="requestsUnread > 0"
            color="primary"
            rounded
            :label="requestsUnread"
            :aria-label="t('messaging.list.unread', { count: requestsUnread })"
            class="conversation-list__tab-unread"
          />
        </span>
      </q-tab>
    </q-tabs>

    <template v-if="tab === 'chats'">
      <q-input
        v-model="query"
        class="q-ma-sm"
        dense
        outlined
        clearable
        :placeholder="t('messaging.list.searchPlaceholder')"
        :aria-label="t('messaging.list.searchLabel')"
        data-testid="conversation-search"
      >
        <template #prepend><q-icon name="search" /></template>
      </q-input>

      <div
        v-if="showLoading"
        class="text-center q-pa-md text-grey"
        role="status"
        data-testid="conversation-list-loading"
      >
        <q-spinner color="primary" size="2em" />
        <div class="q-mt-sm">{{ t('messaging.list.loading') }}</div>
      </div>

      <template v-else>
        <q-list v-if="visibleChats.length > 0" data-testid="conversation-list-chats">
          <q-item-label v-if="searching" header>{{ t('messaging.list.chats') }}</q-item-label>
          <q-item
            v-for="conversation in visibleChats"
            :key="conversation.peer"
            clickable
            :active="conversation.peer === selectedPeer"
            :data-peer="conversation.peer"
            class="conversation-list__item"
            @click="emit('select', conversation.peer)"
          >
            <q-item-section avatar>
              <q-avatar v-if="pictureOf(conversation.peer)">
                <RemoteImage :src="pictureOf(conversation.peer) ?? ''" />
              </q-avatar>
              <q-avatar v-else color="primary" text-color="white" icon="person" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="conversation-list__name" lines="1">{{
                nameOf(conversation.peer)
              }}</q-item-label>
              <q-item-label caption lines="1">{{ preview(conversation) }}</q-item-label>
            </q-item-section>
            <q-item-section v-if="conversation.unread > 0 || conversation.removable" side>
              <q-badge
                v-if="conversation.unread > 0"
                color="primary"
                rounded
                :label="conversation.unread"
                :aria-label="t('messaging.list.unread', { count: conversation.unread })"
                class="conversation-list__unread"
              />
              <q-btn
                v-else
                flat
                round
                dense
                size="sm"
                icon="close"
                :aria-label="t('messaging.list.remove', { name: nameOf(conversation.peer) })"
                data-testid="conversation-remove"
                @click.stop="emit('remove', conversation.peer)"
              />
            </q-item-section>
          </q-item>
        </q-list>

        <q-list v-if="startable.length > 0" data-testid="conversation-search-results">
          <q-item-label header>{{ t('messaging.list.start') }}</q-item-label>
          <q-item
            v-for="peer in startable"
            :key="peer"
            clickable
            :data-peer="peer"
            class="conversation-list__item"
            @click="start(peer)"
          >
            <q-item-section avatar>
              <q-avatar v-if="pictureOf(peer)">
                <RemoteImage :src="pictureOf(peer) ?? ''" />
              </q-avatar>
              <q-avatar v-else color="primary" text-color="white" icon="person" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="conversation-list__name" lines="1">{{
                nameOf(peer)
              }}</q-item-label>
              <q-item-label caption lines="1">{{ detailOf(peer) }}</q-item-label>
            </q-item-section>
            <q-item-section side class="text-primary text-weight-medium">{{
              t('messaging.list.startAction')
            }}</q-item-section>
          </q-item>
        </q-list>

        <div
          v-if="searching && visibleChats.length === 0 && startable.length === 0"
          class="text-center q-pa-md text-grey"
          data-testid="conversation-search-empty"
        >
          {{ t('messaging.list.noMatches', { query: searchText }) }}
        </div>

        <div
          v-if="!searching && chats.length === 0"
          class="text-center q-pa-md text-grey"
          data-testid="conversation-list-empty"
        >
          <div class="text-subtitle2">{{ t('messaging.list.noChats') }}</div>
          <div>{{ t('messaging.list.noChatsHint') }}</div>
        </div>
      </template>
    </template>

    <template v-else>
      <q-list v-if="requests.length > 0" data-testid="conversation-list-requests">
        <q-item
          v-for="conversation in requests"
          :key="conversation.peer"
          clickable
          :active="conversation.peer === selectedPeer"
          :data-peer="conversation.peer"
          class="conversation-list__item"
          @click="emit('select', conversation.peer)"
        >
          <q-item-section avatar>
            <q-avatar v-if="pictureOf(conversation.peer)">
              <RemoteImage :src="pictureOf(conversation.peer) ?? ''" />
            </q-avatar>
            <q-avatar v-else color="primary" text-color="white" icon="person" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="conversation-list__name" lines="1">{{
              nameOf(conversation.peer)
            }}</q-item-label>
            <q-item-label caption lines="1">{{ preview(conversation) }}</q-item-label>
          </q-item-section>
          <q-item-section v-if="conversation.unread > 0" side>
            <q-badge
              color="primary"
              rounded
              :label="conversation.unread"
              :aria-label="t('messaging.list.unread', { count: conversation.unread })"
              class="conversation-list__unread"
            />
          </q-item-section>
        </q-item>
      </q-list>
      <div v-else class="text-center q-pa-md text-grey" data-testid="conversation-requests-empty">
        {{ t('messaging.list.noRequests') }}
      </div>
      <div class="text-caption text-grey q-px-md q-pb-md">
        {{ t('messaging.list.requestsNote') }}
      </div>
    </template>
  </nav>
</template>

<style scoped>
.conversation-list__tabs {
  flex: none;
  border-bottom: 1px solid rgba(127, 127, 127, 0.2);
}

.conversation-list__tab-label {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}
</style>
