<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ActiveKeysCard from '@/components/dashboard/ActiveKeysCard.vue';
import ConnectedRelaysCard from '@/components/dashboard/ConnectedRelaysCard.vue';
import QuickSignCard from '@/components/dashboard/QuickSignCard.vue';
import RecentActivityCard from '@/components/dashboard/RecentActivityCard.vue';
import ApprovedClientsCard from '@/components/dashboard/ApprovedClientsCard.vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { getDashboardSummary } from '@/services/dashboard-service';
import { type DashboardSummary } from '@/types';

const { t } = useI18n();
const router = useRouter();

const summary = ref<DashboardSummary | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

async function loadDashboardSummary() {
  loading.value = true;
  error.value = null;
  try {
    summary.value = await getDashboardSummary(9);
  } catch (e) {
    console.error('Failed to load dashboard summary', e);
    error.value = t('dashboard.widgets.common.error');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadDashboardSummary();
});

function openKeyManagement() {
  void router.push({ name: 'keys' });
}

function openRelayManagement() {
  void router.push({ name: 'relays' });
}

function openEventHistory() {
  void router.push({ name: 'event-history' });
}
</script>

<template>
  <q-page class="dashboard-page">
    <section class="dashboard-hero">
      <h1 class="dashboard-hero-title">{{ t('dashboard.title') }}</h1>
      <p class="dashboard-hero-caption">{{ t('dashboard.caption') }}</p>
    </section>

    <section class="dashboard-widget-grid">
      <div class="dashboard-widget-grid__item dashboard-widget-grid__item--approved-clients">
        <ApprovedClientsCard :summary="summary" :loading="loading" :error="error" />
      </div>
      <div class="dashboard-widget-grid__item dashboard-widget-grid__item--active-keys">
        <ActiveKeysCard
          clickable
          :summary="summary"
          :loading="loading"
          @open="openKeyManagement"
        />
      </div>
      <div class="dashboard-widget-grid__item dashboard-widget-grid__item--connected-relays">
        <ConnectedRelaysCard
          clickable
          :summary="summary"
          :loading="loading"
          @open="openRelayManagement"
        />
      </div>
      <div class="dashboard-widget-grid__item dashboard-widget-grid__item--recent-activity">
        <RecentActivityCard
          clickable
          :summary="summary"
          :loading="loading"
          :error="error"
          @open="openEventHistory"
        />
      </div>
      <div class="dashboard-widget-grid__item dashboard-widget-grid__item--quick-sign">
        <QuickSignCard />
      </div>
    </section>
  </q-page>
</template>

<style scoped>
.dashboard-widget-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-areas:
    'approvedClients activeKeys connectedRelays'
    'recentActivity recentActivity quickSign';
  align-items: start;
}

.dashboard-widget-grid__item {
  min-width: 0;
}

.dashboard-widget-grid__item--approved-clients {
  grid-area: approvedClients;
}

.dashboard-widget-grid__item--active-keys {
  grid-area: activeKeys;
}

.dashboard-widget-grid__item--connected-relays {
  grid-area: connectedRelays;
}

.dashboard-widget-grid__item--recent-activity {
  grid-area: recentActivity;
}

.dashboard-widget-grid__item--quick-sign {
  grid-area: quickSign;
}

@media (max-width: 1023px) {
  .dashboard-widget-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-areas:
      'approvedClients activeKeys'
      'connectedRelays connectedRelays'
      'recentActivity recentActivity'
      'quickSign quickSign';
  }
}

@media (max-width: 699px) {
  .dashboard-widget-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'approvedClients'
      'activeKeys'
      'connectedRelays'
      'recentActivity'
      'quickSign';
  }
}
</style>
