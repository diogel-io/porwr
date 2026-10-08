<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { getAllowedDurations, type RequestRiskClass } from '@/services/approval-preview';
import type { ApprovalDuration } from '@/../src-bex/types/background';

defineOptions({ name: 'RequestDecisionBar' });

const props = defineProps<{
  riskClass: RequestRiskClass;
  allowRemember: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (event: 'decide', approved: boolean, duration: ApprovalDuration): void;
}>();

const { t } = useI18n();

/**
 * Options that are not available are absent rather than shown disabled: payments are one-time,
 * unknown kinds may only be approved once, and elevated kinds are never granted `always`
 * (ADR D11, D12).
 */
const allowed = computed(() => getAllowedDurations(props.riskClass, props.allowRemember));

const duration = ref<ApprovalDuration>('once');

watch(
  allowed,
  (options) => {
    // Nothing beyond `once` is ever pre-selected.
    if (!options.includes(duration.value)) duration.value = 'once';
  },
  { immediate: true },
);

const durationOptions = computed(() =>
  allowed.value.map((value) => ({
    label: t(`request.durations.${value === '8h' ? 'eightHours' : value}`),
    value,
  })),
);
</script>

<template>
  <div class="decision-bar">
    <div v-if="allowed.length > 1" class="decision-bar__duration">
      <label class="decision-bar__label" for="approval-duration">
        {{ t('request.durations.label') }}
      </label>
      <q-select
        id="approval-duration"
        v-model="duration"
        :options="durationOptions"
        dense
        outlined
        emit-value
        map-options
        options-dense
      />
    </div>
    <p v-else class="decision-bar__single">{{ t('request.durations.onceOnly') }}</p>

    <div class="decision-bar__actions">
      <q-btn
        no-caps
        class="diogel-btn-danger"
        :disable="busy"
        :label="t('request.reject')"
        @click="emit('decide', false, 'once')"
      />
      <q-btn
        no-caps
        class="diogel-btn-primary"
        :disable="busy"
        :label="t('request.approve')"
        @click="emit('decide', true, duration)"
      />
    </div>
  </div>
</template>

<style scoped>
/*
 * Pinned to the bottom of the request view: content scrolls, the controls do not scroll away,
 * however long the event is (specification §7, NFR-12).
 */
.decision-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 0 0;
  background: var(--page-bg);
  border-top: 1px solid var(--border-color);
}

.decision-bar__label {
  display: block;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #888);
  margin-bottom: 4px;
}

.decision-bar__single {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted, #888);
}

/* Reject comes first in reading order (specification §7). */
.decision-bar__actions {
  display: flex;
  gap: 8px;
}

.decision-bar__actions .q-btn {
  flex: 1 1 0;
  min-width: 0;
}
</style>
