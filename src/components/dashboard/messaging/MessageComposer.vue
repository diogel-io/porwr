<script lang="ts" setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

defineOptions({ name: 'MessageComposer' });

const props = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  send: [content: string];
}>();

const { t } = useI18n();
const draft = ref('');

function send() {
  const content = draft.value.trim();
  if (!content || props.disabled) return;
  emit('send', content);
  draft.value = '';
}

/** Enter sends; Shift+Enter starts a new line, as in most chat clients. */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}
</script>

<template>
  <div class="message-composer row items-end q-gutter-sm">
    <q-input
      v-model="draft"
      class="col"
      type="textarea"
      autogrow
      dense
      outlined
      :disable="disabled"
      :placeholder="t('messaging.composer.placeholder')"
      :aria-label="t('messaging.composer.label')"
      @keydown="onKeydown"
    />
    <q-btn
      class="diogel-btn-primary"
      icon="send"
      round
      :disable="disabled || !draft.trim()"
      :aria-label="t('messaging.composer.send')"
      @click="send"
    />
  </div>
</template>

<style scoped></style>
