<script lang="ts" setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import RequestOriginHeader from 'components/sidebar/RequestOriginHeader.vue';
import RequestPreview from 'components/sidebar/RequestPreview.vue';
import RequestRiskWarning from 'components/sidebar/RequestRiskWarning.vue';
import RequestDecisionBar from 'components/sidebar/RequestDecisionBar.vue';
import {
  classifyRequest,
  getEventKindLabel,
  getRequestTypeLabel,
  httpAuthOtherOrigin,
} from 'src/services/approval-preview';
import type {
  ApprovalDuration,
  ApprovalRequestContent,
  ApprovalRequestRecord,
} from 'app/src-bex/types/background';

defineOptions({ name: 'CurrentRequest' });

const props = defineProps<{
  request: ApprovalRequestRecord;
  content: ApprovalRequestContent | null;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (event: 'decide', id: string, approved: boolean, duration: ApprovalDuration): void;
  (event: 'rejectAndSwitch', request: ApprovalRequestRecord): void;
}>();

const { t } = useI18n();

const heading = ref<HTMLElement | null>(null);

const riskClass = computed(() => classifyRequest(props.request.requestType, props.request.eventKind));

const requestTypeLabel = computed(() => getRequestTypeLabel(props.request.requestType));

const kindLabel = computed(() =>
  props.request.eventKind >= 0 ? getEventKindLabel(props.request.eventKind) : null,
);

/**
 * The server an HTTP authentication event would prove the user's identity to, when it is not the
 * site asking (#215). Warned about, not refused: an app may call its own API on another host.
 */
const otherOrigin = computed(() =>
  httpAuthOtherOrigin(props.content?.event, props.request.origin),
);

/**
 * The site is connected as one account and another is active (#116, workspace#23).
 *
 * Only shown when both are known: a request that acts for no account has nothing to compare.
 */
const notActiveAlias = computed(() => {
  const { accountPubkey, activeAccountPubkey, activeAccountAlias } = props.request;
  if (!accountPubkey || !activeAccountPubkey || accountPubkey === activeAccountPubkey) return null;
  return activeAccountAlias;
});

const isTerminal = computed(() =>
  props.request.state === 'expired' || props.request.state === 'interrupted',
);

// Focus lands on the heading, never on an approve control (NFR-2).
watch(
  () => props.request.id,
  async () => {
    await nextTick();
    heading.value?.focus();
  },
  { immediate: true },
);
</script>

<template>
  <article class="current-request">
    <h2 ref="heading" tabindex="-1" class="current-request__heading">
      {{ requestTypeLabel }}
    </h2>

    <RequestOriginHeader
      :origin="request.origin"
      :account-alias="request.accountAlias"
      :active-account-alias="notActiveAlias"
    />

    <div v-if="kindLabel" class="current-request__kind">
      <span class="current-request__kind-label">{{ t('request.kind') }}</span>
      <span class="current-request__kind-value">{{ kindLabel }}</span>
    </div>

    <RequestRiskWarning :risk-class="riskClass" :event-kind="request.eventKind" />

    <div v-if="otherOrigin" class="current-request__other-origin" role="alert">
      <q-icon name="gpp_maybe" size="sm" aria-hidden="true" />
      <span>
        {{ t('request.httpAuth.otherOrigin', { target: otherOrigin, site: request.origin }) }}
      </span>
    </div>

    <!-- A terminal request shows why it cannot be acted on, and offers no approval control. -->
    <div v-if="isTerminal" class="current-request__terminal" role="status">
      {{
        request.state === 'expired'
          ? t('request.states.expired')
          : t('request.states.interrupted')
      }}
    </div>

    <template v-else>
      <RequestPreview :content="content" :risk-class="riskClass" :open-full="!!otherOrigin" />
      <RequestDecisionBar
        :risk-class="riskClass"
        :allow-remember="content?.allowRemember ?? false"
        :busy="busy"
        @decide="(approved, duration) => emit('decide', request.id, approved, duration)"
      />
      <!-- Rejects, then switches. It never approves: nothing signs as an account this prompt did
           not name. -->
      <div v-if="notActiveAlias" class="current-request__switch">
        <q-btn
          no-caps
          flat
          size="sm"
          color="primary"
          data-testid="reject-and-switch"
          :disable="busy"
          :label="t('request.account.rejectAndSwitch', { active: notActiveAlias })"
          @click="emit('rejectAndSwitch', request)"
        />
        <div class="current-request__switch-hint">
          {{ t('request.account.rejectAndSwitchHint', { active: notActiveAlias }) }}
        </div>
      </div>
    </template>
  </article>
</template>

<style scoped>
.current-request__switch {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.current-request__switch-hint {
  font-size: 0.75rem;
  color: var(--text-muted, #888);
}

/* The column inset belongs to the page, once. See SidebarHome. */
.current-request {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.current-request__heading {
  margin: 0;
  font-size: 1rem;
  outline: none;
}

/* Stronger than the elevated warning: the site is asking for access somewhere else (#215). */
.current-request__other-origin {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--q-negative, #c10015);
  font-size: 0.8rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.current-request__kind {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.8rem;
}

.current-request__kind-label {
  color: var(--text-muted, #888);
}

.current-request__kind-value {
  font-weight: 600;
  text-align: right;
  overflow-wrap: anywhere;
}

.current-request__terminal {
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 0.85rem;
}
</style>
