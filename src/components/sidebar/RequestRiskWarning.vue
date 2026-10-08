<script lang="ts" setup>
import { computed } from 'vue';

import { getRiskWarning, type RequestRiskClass } from '@/services/approval-preview';

defineOptions({ name: 'RequestRiskWarning' });

const props = defineProps<{
  riskClass: RequestRiskClass;
  eventKind: number;
}>();

const warning = computed(() => getRiskWarning(props.riskClass, props.eventKind));
</script>

<template>
  <!--
    Part of the request body rather than a dismissible banner, and it names the specific effect
    rather than warning in general terms (ADR D12). Not colour-only: it carries an icon and text.
  -->
  <div v-if="warning" class="risk-warning" :class="`risk-warning--${riskClass}`" role="note">
    <q-icon name="report_problem" size="sm" aria-hidden="true" />
    <span>{{ warning }}</span>
  </div>
</template>

<style scoped>
.risk-warning {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.risk-warning--elevated {
  border-color: var(--q-warning, #b26a00);
}

.risk-warning--unknown {
  border-color: var(--q-negative, #c10015);
}
</style>
