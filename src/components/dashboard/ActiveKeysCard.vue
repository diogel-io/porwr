<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { type DashboardSummary } from '@/types';

const props = withDefaults(
  defineProps<{
    summary?: DashboardSummary | null;
    loading?: boolean;
    clickable?: boolean;
  }>(),
  {
    summary: null,
    loading: false,
    clickable: false,
  },
);

const emit = defineEmits<{
  open: [];
}>();

const { t } = useI18n();

function onClick() {
  if (!props.clickable) {
    return;
  }

  emit('open');
}
</script>

<template>
  <q-card class="dashboard-card" :clickable="clickable" @click="onClick">
    <q-card-section class="dashboard-card-section dashboard-widget-card__section">

      <div class="dashboard-widget-card__header">
        <q-icon name="key" size="xl" color="primary" />
        <span class="dashboard-widget-card__title">{{ t('dashboard.widgets.activeKeys.title') }}</span>
      </div>

      <div class="dashboard-widget-card__metric">
        <q-spinner v-if="loading" color="primary" size="24px" />
        <span v-else>{{ summary?.activeKeys ?? 0 }}</span>
      </div>

    </q-card-section>
  </q-card>
</template>

<style scoped>
.dashboard-widget-card__section {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dashboard-widget-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dashboard-widget-card__title {
  margin: 0;
  color: var(--text-color);
  font-size: 1rem;
  font-weight: 600;
}

.dashboard-widget-card__metric {
  margin-top: 6px;
  min-height: 36px;
  display: flex;
  align-items: center;
  color: var(--text-color);
  font-size: 1.9rem;
  font-weight: 700;
}

</style>
