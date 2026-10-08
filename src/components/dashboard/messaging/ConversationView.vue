<script lang="ts" setup>
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MessageComposer from '@/components/dashboard/messaging/MessageComposer.vue';
import type { DirectMessage, PendingMessage } from '@/types/messaging';

defineOptions({ name: 'ConversationView' });

const props = defineProps<{
  peerName: string;
  messages: DirectMessage[];
  pending: PendingMessage[];
  me: string;
  /** The peer has no kind 10050, so nothing can be delivered to them. */
  recipientNotReady?: boolean;
  /** Sending is impossible right now, e.g. the account has no inbox of its own yet. */
  disabled?: boolean;
}>();

const emit = defineEmits<{
  send: [content: string];
  retry: [clientMessageId: string];
}>();

const { t } = useI18n();
const scroller = ref<HTMLElement | null>(null);

function timeOf(message: DirectMessage): string {
  return new Date(message.created_at * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

watch(
  () => [props.messages.length, props.pending.length],
  async () => {
    await nextTick();
    scroller.value?.scrollTo?.({ top: scroller.value.scrollHeight });
  },
  { immediate: true },
);
</script>

<template>
  <section class="conversation-view column no-wrap" :aria-label="t('messaging.view.label', { name: peerName })">
    <header class="conversation-view__header q-pa-md text-subtitle1">{{ peerName }}</header>

    <q-banner v-if="recipientNotReady" class="q-mx-md" dense rounded data-testid="recipient-not-ready">
      {{ t('messaging.view.recipientNotReady', { name: peerName }) }}
    </q-banner>

    <div ref="scroller" class="conversation-view__messages col q-pa-md" role="log" aria-live="polite">
      <div v-if="messages.length === 0 && pending.length === 0" class="text-center text-grey q-pa-md">
        {{ t('messaging.view.empty') }}
      </div>

      <div
        v-for="message in messages"
        :key="message.id"
        class="conversation-view__message q-mb-sm"
        :class="message.pubkey === me ? 'conversation-view__message--mine' : 'conversation-view__message--theirs'"
        :data-from="message.pubkey === me ? 'me' : 'peer'"
      >
        <div class="conversation-view__bubble">{{ message.content }}</div>
        <div class="text-caption text-grey">{{ timeOf(message) }}</div>
      </div>

      <div
        v-for="message in pending"
        :key="message.clientMessageId"
        class="conversation-view__message conversation-view__message--mine q-mb-sm"
        :data-status="message.status"
      >
        <div class="conversation-view__bubble">{{ message.content }}</div>
        <div v-if="message.status === 'sending'" class="text-caption text-grey">{{ t('messaging.view.sending') }}</div>
        <div v-else class="text-caption text-negative">
          {{ t('messaging.view.failed') }}
          <q-btn flat dense size="sm" :label="t('messaging.view.retry')" @click="emit('retry', message.clientMessageId)" />
        </div>
      </div>
    </div>

    <div class="q-pa-md">
      <MessageComposer :disabled="disabled || recipientNotReady" @send="(content) => emit('send', content)" />
    </div>
  </section>
</template>

<style scoped>
/* Fill the pane, so the messages scroll and the composer stays at the bottom. */
.conversation-view {
  flex: 1;
  min-height: 0;
}

.conversation-view__messages {
  overflow-y: auto;
  min-height: 0;
}

.conversation-view__message {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.conversation-view__message--mine {
  align-items: flex-end;
}

.conversation-view__bubble {
  max-width: 75%;
  padding: 0.5rem 0.75rem;
  border-radius: 0.75rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--q-dark-page, rgba(127, 127, 127, 0.15));
}

.conversation-view__message--mine .conversation-view__bubble {
  background: var(--q-primary);
  color: #fff;
}
</style>
