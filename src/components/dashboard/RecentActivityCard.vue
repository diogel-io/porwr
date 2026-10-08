<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DashboardActivityItem } from '@/services/dashboard-service';
import { nip19 } from 'nostr-tools';
import type { DashboardSummary, DataActivityRow } from '@/types';

const props = withDefaults(
  defineProps<{
    summary?: DashboardSummary | null;
    loading?: boolean;
    error?: string | null;
    clickable?: boolean;
  }>(),
  {
    summary: null,
    loading: false,
    error: null,
    clickable: false,
  },
);

const emit = defineEmits<{
  open: [];
}>();

const { t, d } = useI18n();

const items = computed(() => props.summary?.recentActivity ?? []);

type ActivityStatusVariant = 'success' | 'error' | 'rejected';

const statusText = computed(() => {
  if (props.error) {
    return t('dashboard.widgets.common.error');
  }

  const state = props.summary?.state ?? 'no-account';

  if (state === 'locked') {
    return t('dashboard.widgets.common.locked');
  }

  if (state === 'no-account') {
    return t('dashboard.widgets.common.noAccount');
  }

  if (!items.value.length) {
    return t('dashboard.widgets.recentActivity.empty');
  }

  return t('dashboard.widgets.recentActivity.ready');
});

function onClick() {
  if (!props.clickable) {
    return;
  }

  emit('open');
}

function formatActivityTime(value: string | undefined): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  try {
    const localized = d(date, 'short');
    if (localized.trim().length > 0) {
      return localized;
    }
  } catch {
    // Fall through to Intl fallback when i18n datetime formats are unavailable.
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatShortNpub(npub: string): string {
  if (npub.length <= 11) {
    return npub;
  }

  return `${npub.slice(0, 5)}...${npub.slice(-4)}`;
}

function formatActivityEventLabel(activity: DashboardActivityItem): string {
  if (typeof activity.eventKind === 'undefined') {
    return t('dashboard.widgets.recentActivity.eventType.extensionException');
  }

  const kind = String(activity.eventKind);
  const namedKinds: Record<string, string> = {
    '0': t('dashboard.widgets.recentActivity.eventType.named.profile'),
    '1': t('dashboard.widgets.recentActivity.eventType.named.note'),
    '4': t('dashboard.widgets.recentActivity.eventType.named.directMessage'),
    '30023': t('dashboard.widgets.recentActivity.eventType.named.longForm'),
  };
  const kindName = namedKinds[kind];

  if (kindName) {
    return t('dashboard.widgets.recentActivity.eventType.kindWithName', { kind, name: kindName });
  }

  return t('dashboard.widgets.recentActivity.eventType.kind', { kind });
}

function formatActivityKeyChip(activity: DashboardActivityItem): string {
  if (activity.accountNpub) {
    try {
      const npub = nip19.npubEncode(activity.accountNpub);
      return formatShortNpub(npub);
    } catch {
      return formatShortNpub(activity.accountNpub);
    }
  }

  if (activity.accountAlias) {
    return activity.accountAlias;
  }

  return t('dashboard.widgets.recentActivity.unknownKey');
}

function resolveActivityIcon(activity: DashboardActivityItem): { name: string; color: string } {
  if (activity.status === 'exception' || activity.status === 'rejected') {
    return { name: 'error_outline', color: 'negative' };
  }

  const kind = typeof activity.eventKind === 'undefined' ? undefined : String(activity.eventKind);

  if (kind === '0') {
    return { name: 'person_outline', color: 'primary' };
  }

  if (kind === '1') {
    return { name: 'chat_bubble_outline', color: 'primary' };
  }

  if (kind === '4') {
    return { name: 'lock_outline', color: 'primary' };
  }

  if (kind === '30023') {
    return { name: 'notes', color: 'primary' };
  }

  return { name: 'check_circle_outline', color: 'positive' };
}

function formatActivityStatus(activity: DashboardActivityItem): string {
  if (activity.status === 'approved' || activity.status === 'signed') {
    return t('dashboard.widgets.recentActivity.status.success');
  }

  if (activity.status === 'rejected') {
    return t('dashboard.widgets.recentActivity.status.rejected');
  }

  return t('dashboard.widgets.recentActivity.status.error');
}

function formatActivityStatusVariant(activity: DashboardActivityItem): ActivityStatusVariant {
  if (activity.status === 'approved' || activity.status === 'signed') {
    return 'success';
  }

  if (activity.status === 'rejected') {
    return 'rejected';
  }

  return 'error';
}

const recentActivityRows = computed<DataActivityRow[]>(() =>
  items.value.map((activity) => {
    const icon = resolveActivityIcon(activity);

    return {
      key: `${activity.dateTime}:${activity.type}:${activity.detail ?? activity.title}`,
      icon: icon.name,
      iconColor: icon.color,
      eventLabel: formatActivityEventLabel(activity),
      keyChip: formatActivityKeyChip(activity),
      time: formatActivityTime(activity.dateTime),
      statusLabel: formatActivityStatus(activity),
      statusVariant: formatActivityStatusVariant(activity),
    };
  }),
);
</script>

<template>
  <q-card class="dashboard-card" :clickable="clickable" @click="onClick">
    <q-card-section class="dashboard-card-section dashboard-widget-card__section">
      <div class="dashboard-widget-card__header">
        <q-icon name="flaky" size="sm" color="primary" />
        <h2 class="dashboard-widget-card__title">
          {{ t('dashboard.widgets.recentActivity.title') }}
        </h2>
      </div>

      <div v-if="!loading && recentActivityRows.length > 0" class="dashboard-widget-card__table">
        <div class="dashboard-widget-card__table-head">
          <span class="dashboard-widget-card__head-event">{{
            t('dashboard.widgets.recentActivity.columns.eventType')
          }}</span>
          <span class="dashboard-widget-card__head-key">{{
            t('dashboard.widgets.recentActivity.columns.keyPubkey')
          }}</span>
          <span class="dashboard-widget-card__head-time">{{
            t('dashboard.widgets.recentActivity.columns.time')
          }}</span>
          <span class="dashboard-widget-card__head-status">{{
            t('dashboard.widgets.recentActivity.columns.status')
          }}</span>
        </div>

        <div
          v-for="row in recentActivityRows"
          :key="row.key"
          class="dashboard-widget-card__table-row"
        >
          <div class="dashboard-widget-card__event">
            <q-icon :name="row.icon" :color="row.iconColor" size="16px" />
            <span class="dashboard-widget-card__event-label">{{ row.eventLabel }}</span>
          </div>

          <q-chip square dense class="dashboard-widget-card__chip">{{ row.keyChip }}</q-chip>

          <span class="dashboard-widget-card__time">{{ row.time }}</span>

          <q-badge
            rounded
            class="dashboard-widget-card__status"
            :class="`dashboard-widget-card__status--${row.statusVariant}`"
          >
            {{ row.statusLabel }}
          </q-badge>
        </div>
      </div>

      <div v-else class="dashboard-widget-card__state">
        <q-spinner v-if="loading" color="primary" size="24px" />
        <p class="dashboard-widget-card__caption">{{ statusText }}</p>
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

.dashboard-widget-card__table {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
}

.dashboard-widget-card__table-head,
.dashboard-widget-card__table-row {
  display: grid;
  grid-template-columns: minmax(0, 2.2fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 0.9fr);
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
}

.dashboard-widget-card__table-head {
  color: var(--text-muted);
  font-size: 0.75rem;
  letter-spacing: 0.02em;
  border-bottom: 1px solid var(--border-color);
}

.dashboard-widget-card__table-row:not(:last-child) {
  border-bottom: 1px solid var(--border-color);
}

.dashboard-widget-card__event {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.dashboard-widget-card__event-label,
.dashboard-widget-card__time,
.dashboard-widget-card__table-head > span,
.dashboard-widget-card__chip {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dashboard-widget-card__chip {
  justify-self: start;
  max-width: 100%;
}

.dashboard-widget-card__time {
  color: var(--text-muted);
}

.dashboard-widget-card__status {
  justify-self: start;
}

.dashboard-widget-card__status--success {
  background: rgba(25, 118, 210, 0.14);
  color: #1976d2;
}

.dashboard-widget-card__status--error {
  background: rgba(211, 47, 47, 0.14);
  color: #d32f2f;
}

.dashboard-widget-card__status--rejected {
  background: rgba(245, 124, 0, 0.16);
  color: #f57c00;
}

.dashboard-widget-card__state {
  min-height: 78px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
}

.dashboard-widget-card__caption {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
  line-height: 1.5;
}

@media (max-width: 680px) {
  .dashboard-widget-card__table-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'event key'
      'time status';
    row-gap: 6px;
  }

  .dashboard-widget-card__table-head {
    display: none;
  }

  .dashboard-widget-card__event {
    grid-area: event;
  }

  .dashboard-widget-card__chip {
    grid-area: key;
    justify-self: end;
    max-width: min(180px, 100%);
  }

  .dashboard-widget-card__time {
    grid-area: time;
  }

  .dashboard-widget-card__status {
    grid-area: status;
    justify-self: end;
  }
}
</style>
