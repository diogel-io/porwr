<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { QTableColumn } from 'quasar';
import { logService } from '@/services/log-service';
import type { ApprovalLog, ExceptionLog } from '@/services/database';
import useAccountStore from '@/stores/account-store';

const { t } = useI18n();
const accountStore = useAccountStore();
const tab = ref('approvals');
const approvals = ref<ApprovalLog[]>([]);
const exceptions = ref<ExceptionLog[]>([]);
const lastFetchedAlias = ref<string | undefined>(undefined);

let accountHydrationPromise: Promise<void> | null = null;
let inFlightFetchPromise: Promise<void> | null = null;
let inFlightFetchAlias: string | undefined;

const ensureAccountStateLoaded = async () => {
  if (!accountHydrationPromise) {
    accountHydrationPromise = accountStore.getKeys().finally(() => {
      accountHydrationPromise = null;
    });
  }

  await accountHydrationPromise;
};

const fetchLogs = async (force = false) => {
  await ensureAccountStateLoaded();

  const activeKey = accountStore.activeKey;
  if (!activeKey) {
    approvals.value = [];
    exceptions.value = [];
    lastFetchedAlias.value = undefined;
    return;
  }

  if (!force && lastFetchedAlias.value === activeKey) {
    return;
  }

  if (!force && inFlightFetchPromise && inFlightFetchAlias === activeKey) {
    await inFlightFetchPromise;
    return;
  }

  const fetchPromise = (async () => {
    approvals.value = await logService.getApprovals(activeKey);
    exceptions.value = await logService.getExceptions(activeKey);
    lastFetchedAlias.value = activeKey;
  })();

  inFlightFetchAlias = activeKey;
  inFlightFetchPromise = fetchPromise;

  try {
    await fetchPromise;
  } finally {
    if (inFlightFetchPromise === fetchPromise) {
      inFlightFetchPromise = null;
      inFlightFetchAlias = undefined;
    }
  }
};

onMounted(() => {
  void fetchLogs();
});

watch(() => accountStore.activeKey, () => {
  void fetchLogs();
});

const approvalColumns = computed<QTableColumn[]>(() => [
  {
    name: 'dateTime',
    label: t('logs.columns.dateTime'),
    field: 'dateTime',
    align: 'left',
    sortable: true,
  },
  {
    name: 'eventKind',
    label: t('logs.columns.eventKind'),
    field: 'eventKind',
    align: 'left',
    sortable: true,
  },
  {
    name: 'hostname',
    label: t('logs.columns.hostname'),
    field: 'hostname',
    align: 'left',
    sortable: true,
  },
]);

const exceptionColumns = computed<QTableColumn[]>(() => [
  {
    name: 'dateTime',
    label: t('logs.columns.dateTime'),
    field: 'dateTime',
    align: 'left',
    sortable: true,
  },
  {
    name: 'hostname',
    label: t('logs.columns.hostname'),
    field: 'hostname',
    align: 'left',
    sortable: true,
  },
  {
    name: 'message',
    label: t('logs.columns.message'),
    field: 'message',
    align: 'left',
    sortable: true,
  },
]);

const formatDateTime = (val: string) => {
  try {
    return new Date(val).toLocaleString();
  } catch {
    return val;
  }
};
</script>

<template>
  <q-page class="dashboard-page logs-page">
    <section class="dashboard-hero">
      <div>
        <h1 class="dashboard-hero-title">{{ t('logs.title') }}</h1>
        <p class="dashboard-hero-caption">{{ t('logs.dashboardCaption') }}</p>
      </div>
      <q-btn
        class="dashboard-hero-action diogel-btn-ghost"
        round
        icon="refresh"
        @click="fetchLogs(true)"
      />
    </section>

    <q-card class="dashboard-card logs-page__card">
      <q-tabs
        v-model="tab"
        active-color="primary"
        align="justify"
        class="dashboard-tabs text-primary text-caption"
        dense
        indicator-color="primary"
        inline-label
        narrow-indicator
      >
        <q-tab name="approvals" :label="t('logs.tabs.approvals')" />
        <q-tab name="exceptions" :label="t('logs.tabs.exceptions')" />
      </q-tabs>

      <q-tab-panels v-model="tab" animated class="logs-page__tab-panels">
        <q-tab-panel name="approvals" class="q-pa-none">
          <q-table
            :rows="approvals"
            :columns="approvalColumns"
            row-key="id"
            flat
            bordered
            :no-data-label="t('logs.noData')"
            :pagination="{ rowsPerPage: 10 }"
          >
            <template v-slot:body-cell-dateTime="props">
              <q-td :props="props">
                {{ formatDateTime(props.value) }}
              </q-td>
            </template>
          </q-table>
        </q-tab-panel>

        <q-tab-panel name="exceptions" class="q-pa-none">
          <q-table
            :rows="exceptions"
            :columns="exceptionColumns"
            row-key="id"
            flat
            bordered
            :no-data-label="t('logs.noData')"
            :pagination="{ rowsPerPage: 10 }"
          >
            <template v-slot:body-cell-dateTime="props">
              <q-td :props="props">
                {{ formatDateTime(props.value) }}
              </q-td>
            </template>
            <template v-slot:body-cell-message="props">
              <q-td
                :props="props"
                class="text-wrap"
                style="word-break: break-all; white-space: normal"
              >
                {{ props.value }}
              </q-td>
            </template>
          </q-table>
        </q-tab-panel>
      </q-tab-panels>
    </q-card>
  </q-page>
</template>

<style scoped>
.logs-page {
  width: 100%;
}

.logs-page__card {
  overflow: hidden;
}

.logs-page__tab-panels {
  background: transparent;
}

.text-wrap {
  max-width: 400px;
}
</style>
