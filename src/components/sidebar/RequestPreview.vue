<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  formatEventFields,
  shouldDefaultToFullEvent,
  truncateForPreview,
  type RequestRiskClass,
} from 'src/services/approval-preview';
import type { ApprovalRequestContent } from 'app/src-bex/types/background';

defineOptions({ name: 'RequestPreview' });

const props = defineProps<{
  content: ApprovalRequestContent | null;
  riskClass: RequestRiskClass;
  /** Open on the full event whatever the class: HTTP authentication for another site (#215). */
  openFull?: boolean;
}>();

const { t } = useI18n();

type PreviewMode = 'formatted' | 'raw' | 'full';

const mode = ref<PreviewMode>('formatted');
const expanded = ref(false);

// Unknown kinds open on the full event, because the formatted view cannot explain something
// Porwr does not recognise (ADR D12).
watch(
  () => [props.riskClass, props.openFull] as const,
  ([riskClass, openFull]) => {
    mode.value = openFull || shouldDefaultToFullEvent(riskClass) ? 'full' : 'formatted';
  },
  { immediate: true },
);

const event = computed(() => props.content?.event ?? null);

const rawContent = computed(() => event.value?.content ?? props.content?.contentDescription ?? '');

const truncated = computed(() => truncateForPreview(rawContent.value));

const shownContent = computed(() =>
  expanded.value ? rawContent.value : truncated.value.text,
);

const formattedFields = computed(() => (event.value ? formatEventFields(event.value) : []));

const fullEventJson = computed(() =>
  event.value ? JSON.stringify(event.value, null, 2) : '',
);
</script>

<template>
  <section class="request-preview" :aria-label="t('request.preview.ariaLabel')">
    <q-btn-toggle
      v-if="event"
      v-model="mode"
      dense
      no-caps
      unelevated
      spread
      class="request-preview__modes"
      :options="[
        { label: t('request.preview.formatted'), value: 'formatted' },
        { label: t('request.preview.raw'), value: 'raw' },
        { label: t('request.preview.full'), value: 'full' },
      ]"
    />

    <div v-if="mode === 'formatted'" class="request-preview__body">
      <div v-for="field in formattedFields" :key="field.label" class="request-preview__field">
        <span class="request-preview__field-label">{{ field.label }}</span>
        <span class="request-preview__field-value">{{ field.value }}</span>
      </div>
      <p v-if="shownContent" class="request-preview__content">{{ shownContent }}</p>
      <p v-else-if="content?.counterpartyPubkey" class="request-preview__content">
        {{ t('request.preview.counterparty', { pubkey: content.counterpartyPubkey }) }}
      </p>
    </div>

    <pre v-else-if="mode === 'raw'" class="request-preview__pre">{{ shownContent }}</pre>

    <pre v-else class="request-preview__pre">{{ fullEventJson }}</pre>

    <!-- Truncation is never silent: the user is told and can expand. -->
    <q-btn
      v-if="truncated.truncated && mode !== 'full'"
      flat
      dense
      no-caps
      size="sm"
      class="request-preview__expand"
      :label="
        expanded
          ? t('request.preview.collapse')
          : t('request.preview.expand', { count: truncated.fullLength })
      "
      @click="expanded = !expanded"
    />
  </section>
</template>

<style scoped>
.request-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.request-preview__modes {
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.request-preview__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.request-preview__field {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.8rem;
}

.request-preview__field-label {
  color: var(--text-muted, #888);
}

.request-preview__field-value {
  font-weight: 600;
  text-align: right;
  overflow-wrap: anywhere;
}

.request-preview__content {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

/* Wide content scrolls inside its own box rather than widening the panel. */
.request-preview__pre {
  margin: 0;
  padding: 8px;
  max-height: 220px;
  overflow: auto;
  font-size: 0.75rem;
  /* Deliberately not --header-bg: this is where the user verifies what they are signing, so it
     takes the softer surface and keeps the contrast the chrome colour would spend. */
  background: var(--surface-soft);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.request-preview__expand {
  align-self: flex-start;
}
</style>
