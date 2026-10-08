<script lang="ts" setup>
import { useI18n } from 'vue-i18n';

import { getRequestTypeLabel } from '@/services/approval-preview';
import type { ApprovalRequestRecord } from '@/../src-bex/types/background';

defineOptions({ name: 'PendingRequestList' });

defineProps<{
  requests: ApprovalRequestRecord[];
  currentId: string | null;
}>();

const emit = defineEmits<{
  (event: 'select', id: string): void;
}>();

const { t } = useI18n();
</script>

<template>
  <section v-if="requests.length > 1" class="pending-list">
    <!-- Polite, not assertive: arrivals must not interrupt a review in progress (NFR-4). -->
    <h3 class="pending-list__title" aria-live="polite">
      {{ t('request.pending.title', { count: requests.length }) }}
    </h3>
    <ul class="pending-list__items">
      <li v-for="request in requests" :key="request.id">
        <button
          type="button"
          class="pending-list__item"
          :class="{ 'pending-list__item--current': request.id === currentId }"
          @click="emit('select', request.id)"
        >
          <span class="pending-list__origin">{{ request.origin }}</span>
          <span class="pending-list__type">{{ getRequestTypeLabel(request.requestType) }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
/* The column inset belongs to the page, once; the page's gap separates this from the request. */
.pending-list {
  min-width: 0;
}

.pending-list__title {
  margin: 0 0 6px;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #888);
}

.pending-list__items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pending-list__item {
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  min-width: 0;
}

.pending-list__item--current {
  border-color: var(--q-primary, #6a4cff);
}

.pending-list__origin {
  display: block;
  font-weight: 600;
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.pending-list__type {
  display: block;
  font-size: 0.72rem;
  color: var(--text-muted, #888);
}
</style>
