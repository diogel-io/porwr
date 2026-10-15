<script lang="ts" setup>
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import useAccountStore from '@/stores/account-store';
import ConversationView from '@/components/dashboard/messaging/ConversationView.vue';
import { useDirectMessages } from '@/composables/useDirectMessages';
import { SUPPORT_PUBKEY } from '@/data/support';
import { conversationMessages } from '@/utils/conversations';

/**
 * A NIP-17 conversation with Diogel support (#228).
 *
 * The same messaging as the Messaging page, with one fixed recipient: the account's sent and received
 * support messages in one log. Like Messaging, it fetches only while open and visible.
 */

const { t } = useI18n();
const accountStore = useAccountStore();

const activeKey = computed(() => accountStore.activeAccountOrFirst);
const me = computed(() => activeKey.value?.id ?? '');
const showNoAccount = computed(() => accountStore.hasNoAccounts);

const {
  messages,
  inbox,
  loadFailed,
  pending,
  notReadyPeers,
  poll,
  startPolling,
  loadReadState,
  markRead,
  send,
  retry,
  reset,
} = useDirectMessages({ hasAccount: () => Boolean(activeKey.value) });

const supportMessages = computed(() => conversationMessages(messages.value.values(), SUPPORT_PUBKEY));
const supportPending = computed(() => pending.value.filter((message) => message.peer === SUPPORT_PUBKEY));
/** Support has no kind 10050 that a send could find, so nothing can reach it. */
const supportNotReachable = computed(() => notReadyPeers.value.has(SUPPORT_PUBKEY));

async function load() {
  if (!activeKey.value) return;
  await loadReadState();
  await poll();
}

watch(supportMessages, () => {
  void markRead(SUPPORT_PUBKEY);
});

watch(
  () => activeKey.value?.id,
  (id, previous) => {
    if (previous !== undefined && id !== previous) {
      reset();
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
  <q-page class="dashboard-page support-page">
    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('support.title') }}</h1>
      <p class="dashboard-hero-caption">{{ t('support.dashboardCaption') }}</p>
    </section>

    <div v-if="showNoAccount" class="text-center q-pa-xl">
      <div class="text-h6 text-grey-7">{{ t('account.noAccounts') }}</div>
      <p class="text-grey-6">{{ t('account.noAccountDesc') }}</p>
    </div>

    <template v-else>
      <!-- The DM relay editor checks relays on save (#277); this note says which ones keep messages (#278). -->
      <q-banner class="q-mb-md" rounded data-testid="support-relay-note">
        <div class="text-weight-medium">{{ t('support.relayNote.title') }}</div>
        {{ t('support.relayNote.body') }}
        <template #action>
          <q-btn flat :label="t('support.relayNote.action')" :to="{ name: 'relays' }" />
        </template>
      </q-banner>
      <q-banner v-if="inbox === 'none'" class="q-mb-md" rounded data-testid="no-inbox">
        {{ t('messaging.noInbox') }}
        <template #action>
          <q-btn flat :label="t('messaging.noInboxAction')" :to="{ name: 'relays' }" />
        </template>
      </q-banner>
      <q-banner v-if="loadFailed" class="q-mb-md" rounded data-testid="load-failed">
        {{ t('messaging.loadError') }}
      </q-banner>
      <q-banner v-if="supportNotReachable" class="q-mb-md" rounded data-testid="support-not-reachable">
        {{ t('support.notReachable') }}
      </q-banner>

      <q-card class="dashboard-card support-page__card">
        <!-- Without an inbox of its own the account could never read a reply, so sending waits for one. -->
        <ConversationView
          :peer-name="t('support.peerName')"
          :messages="supportMessages"
          :pending="supportPending"
          :me="me"
          :disabled="inbox !== 'ready' || supportNotReachable"
          @send="(content) => send(SUPPORT_PUBKEY, content)"
          @retry="retry"
        />
      </q-card>
    </template>
  </q-page>
</template>

<style scoped>
.support-page {
  width: 100%;
}

.support-page__card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 24rem;
  height: calc(100vh - 19rem);
}
</style>
