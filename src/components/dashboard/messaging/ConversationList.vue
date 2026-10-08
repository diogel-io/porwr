<script lang="ts" setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConversationSummary } from '@/utils/conversations';

defineOptions({ name: 'ConversationList' });

const props = defineProps<{
  conversations: ConversationSummary[];
  selectedPeer?: string | undefined;
  nameOf: (peer: string) => string;
  pictureOf: (peer: string) => string | undefined;
}>();

const emit = defineEmits<{
  select: [peer: string];
}>();

const { t } = useI18n();

const contacts = computed(() => props.conversations.filter((conversation) => conversation.isContact));
/**
 * Anyone can gift-wrap a message to anyone, so writers outside the contact list are kept apart rather
 * than mixed in with the people the account chose to follow.
 */
const requests = computed(() => props.conversations.filter((conversation) => !conversation.isContact));

const sections = computed(() => [
  { key: 'contacts', label: t('messaging.list.contacts'), items: contacts.value },
  { key: 'requests', label: t('messaging.list.requests'), items: requests.value },
]);

function preview(conversation: ConversationSummary): string {
  return conversation.lastMessage?.content ?? t('messaging.list.noMessages');
}
</script>

<template>
  <nav class="conversation-list" :aria-label="t('messaging.list.label')">
    <template v-for="section in sections" :key="section.key">
      <q-list v-if="section.items.length > 0" :data-testid="`conversation-section-${section.key}`">
        <q-item-label header>{{ section.label }}</q-item-label>
        <q-item
          v-for="conversation in section.items"
          :key="conversation.peer"
          clickable
          :active="conversation.peer === selectedPeer"
          :data-peer="conversation.peer"
          class="conversation-list__item"
          @click="emit('select', conversation.peer)"
        >
          <q-item-section avatar>
            <q-avatar v-if="pictureOf(conversation.peer)">
              <img :src="pictureOf(conversation.peer)" alt="" />
            </q-avatar>
            <q-avatar v-else color="primary" text-color="white" icon="person" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="conversation-list__name">{{ nameOf(conversation.peer) }}</q-item-label>
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
    </template>

    <div v-if="conversations.length === 0" class="text-center q-pa-md text-grey">
      {{ t('messaging.list.empty') }}
    </div>
  </nav>
</template>

<style scoped></style>
