<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import {
  getNip47Balance,
  getNip47Info,
  importNip47Connection,
  listNip47Connections,
  listNip47PaymentHistory,
  payNip47Invoice,
  removeNip47Connection,
  setActiveNip47Connection,
} from '@/services/nip47-service';
import { parseBolt11AmountMsat, previewInvoice } from '@/services/nip47-invoice';
import type { Nip47ConnectionSummary, Nip47PaymentHistoryEntry } from '@/types/nip47';

const $q = useQuasar();
const { t } = useI18n();
const connections = ref<Nip47ConnectionSummary[]>([]);
const nwcUri = ref('');
const label = ref('');
const loading = ref(false);
const testingConnectionId = ref<string | null>(null);
const activationSavePending = ref(false);
const balances = ref<Record<string, number>>({});
const selectedPaymentConnection = ref<Nip47ConnectionSummary | null>(null);
const paymentInvoice = ref('');
const paymentApprovalChecked = ref(false);
const paymentDialogOpen = ref(false);
const payingConnectionId = ref<string | null>(null);
const lastPaymentPreimage = ref<string | null>(null);
const paymentHistory = ref<Nip47PaymentHistoryEntry[]>([]);
const historyLoading = ref(false);
const importPanelOpen = ref(false);
const balanceDisplayUnit = ref<'sats' | 'btc'>('sats');

const hasConnections = computed(() => connections.value.length > 0);
const activeConnection = computed<Nip47ConnectionSummary | null>(() => {
  return connections.value.find((connection) => connection.isActive) ?? connections.value[0] ?? null;
});
const secondaryConnections = computed<Nip47ConnectionSummary[]>(() => {
  const activeId = activeConnection.value?.id;
  return connections.value.filter((connection) => connection.id !== activeId);
});
const activeBalance = computed<number | undefined>(() => {
  const activeId = activeConnection.value?.id;
  return activeId ? balances.value[activeId] : undefined;
});
const activeCanPay = computed(() => Boolean(activeConnection.value?.capabilities.includes('pay_invoice')));
const activeBalanceDisplay = computed(() => {
  const balance = activeBalance.value;
  if (balance === undefined) {
    return t('walletManagement.balance.notChecked');
  }

  return balanceDisplayUnit.value === 'btc' ? formatMsatAsBtc(balance) : formatMsatAsSatsValue(balance);
});
const activeBalanceToggleLabel = computed(() => {
  return activeBalance.value === undefined
    ? t('walletManagement.balance.toggleDisabled')
    : t('walletManagement.balance.toggleAria', { unit: balanceDisplayUnit.value === 'btc' ? 'sats' : 'BTC' });
});
const importPanelVisible = computed(() => importPanelOpen.value || !hasConnections.value);
const parsedInvoiceAmount = computed(() => parseBolt11Amount(paymentInvoice.value));

function shortHex(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}

function formatMsat(msat: number): string {
  return `${formatMsatAsSatsValue(msat)} sats`;
}

function formatMsatAsSatsValue(msat: number): string {
  const sats = msat / 1000;
  return sats.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatMsatAsBtc(msat: number): string {
  const btc = msat / 1000 / 100_000_000;
  return btc.toLocaleString(undefined, {
    minimumFractionDigits: 8,
    maximumFractionDigits: 8,
  });
}

function toggleBalanceDisplayUnit(): void {
  if (activeBalance.value === undefined) {
    return;
  }

  balanceDisplayUnit.value = balanceDisplayUnit.value === 'btc' ? 'sats' : 'btc';
}

function parseBolt11Amount(invoice: string): string {
  if (!invoice.trim()) {
    return t('walletManagement.payment.amountNotEncoded');
  }

  const amountMsat = parseBolt11AmountMsat(invoice);
  if (amountMsat === undefined) {
    return t('walletManagement.payment.amountNotEncoded');
  }

  const sats = amountMsat / 1000;
  return `${sats.toLocaleString(undefined, { maximumFractionDigits: 4 })} sats`;
}

function shortInvoice(invoice: string): string {
  return previewInvoice(invoice);
}

function notifySuccess(message: string): void {
  $q.notify({ type: 'positive', message });
}

function notifyError(error: unknown): void {
  $q.notify({
    type: 'negative',
    message: error instanceof Error ? error.message : String(error),
  });
}

function getConnectionSubtitle(connection: Nip47ConnectionSummary): string {
  return connection.lud16 || shortHex(connection.walletServicePubkey);
}

function getCapabilitySummary(connection: Nip47ConnectionSummary): string {
  if (connection.capabilities.length === 0) {
    return t('walletManagement.capabilities.notChecked');
  }

  return connection.capabilities.join(' · ');
}

function getActiveConnectionStatus(connection: Nip47ConnectionSummary): string {
  if (connection.capabilities.includes('pay_invoice')) {
    return t('walletManagement.status.readyForManualPayments');
  }

  if (connection.capabilities.length > 0) {
    return t('walletManagement.status.paymentsUnavailable');
  }

  return t('walletManagement.status.checkCapabilities');
}

async function refreshPaymentHistory(): Promise<void> {
  historyLoading.value = true;
  try {
    paymentHistory.value = await listNip47PaymentHistory();
  } catch (error: unknown) {
    notifyError(error);
  } finally {
    historyLoading.value = false;
  }
}

async function refreshConnections(): Promise<void> {
  loading.value = true;
  try {
    connections.value = sortConnections(await listNip47Connections());
    importPanelOpen.value = connections.value.length === 0;
    await refreshPaymentHistory();
  } catch (error: unknown) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
}

function sortConnections(items: Nip47ConnectionSummary[]): Nip47ConnectionSummary[] {
  return [...items].sort((left, right) => {
    if (left.isActive !== right.isActive) {
      return left.isActive ? -1 : 1;
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

async function importConnection(): Promise<void> {
  loading.value = true;
  try {
    await importNip47Connection({
      uri: nwcUri.value,
      ...(label.value.trim() ? { label: label.value.trim() } : {}),
    });
    nwcUri.value = '';
    label.value = '';
    importPanelOpen.value = false;
    notifySuccess(t('walletManagement.notifications.imported'));
    await refreshConnections();
  } catch (error: unknown) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
}

async function refreshConnectionInfo(connectionId: string): Promise<void> {
  testingConnectionId.value = connectionId;
  try {
    const info = await getNip47Info(connectionId);
    connections.value = sortConnections(
      connections.value.map((item) => item.id === connectionId
        ? {
            ...item,
            capabilities: info.capabilities,
            lastInfoCheckedAt: info.checkedAt,
            updatedAt: new Date().toISOString(),
          }
        : item),
    );
    notifySuccess(t('walletManagement.notifications.infoLoaded', { capabilities: info.capabilities.join(', ') || t('walletManagement.capabilities.noneAdvertised') }));
  } catch (error: unknown) {
    notifyError(error);
  } finally {
    testingConnectionId.value = null;
  }
}

async function testInfo(connection: Nip47ConnectionSummary): Promise<void> {
  await refreshConnectionInfo(connection.id);
}

async function testBalance(connection: Nip47ConnectionSummary): Promise<void> {
  testingConnectionId.value = connection.id;
  try {
    const balance = await getNip47Balance(connection.id);
    balances.value = {
      ...balances.value,
      [connection.id]: balance.balanceMsat,
    };
    notifySuccess(t('walletManagement.notifications.balanceLoaded', { label: connection.label }));
  } catch (error: unknown) {
    notifyError(error);
  } finally {
    testingConnectionId.value = null;
  }
}

async function makeActive(connection: Nip47ConnectionSummary): Promise<void> {
  const previousConnections = connections.value;
  const optimisticUpdatedAt = new Date().toISOString();

  connections.value = sortConnections(
    connections.value.map((item) => ({
      ...item,
      isActive: item.id === connection.id,
      updatedAt: item.id === connection.id ? optimisticUpdatedAt : item.updatedAt,
    })),
  );
  activationSavePending.value = true;
  notifySuccess(t('walletManagement.notifications.activeWallet', { label: connection.label }));

  try {
    const activeWallet = await setActiveNip47Connection(connection.id);
    connections.value = sortConnections(
      connections.value.map((item) => ({
        ...item,
        isActive: item.id === activeWallet.id,
        updatedAt: item.id === activeWallet.id ? activeWallet.updatedAt : item.updatedAt,
      })),
    );
    void refreshConnectionInfo(activeWallet.id);
  } catch (error: unknown) {
    connections.value = previousConnections;
    notifyError(error);
  } finally {
    activationSavePending.value = false;
  }
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function openPaymentDialog(connection: Nip47ConnectionSummary): void {
  selectedPaymentConnection.value = connection;
  paymentInvoice.value = '';
  paymentApprovalChecked.value = false;
  lastPaymentPreimage.value = null;
  paymentDialogOpen.value = true;
}

async function approvePayment(): Promise<void> {
  const connection = selectedPaymentConnection.value;
  if (!connection) {
    notifyError(new Error(t('walletManagement.errors.noWalletSelected')));
    return;
  }

  payingConnectionId.value = connection.id;
  lastPaymentPreimage.value = null;
  try {
    const payment = await payNip47Invoice(connection.id, paymentInvoice.value);
    lastPaymentPreimage.value = payment.preimage;
    notifySuccess(
      payment.feesPaidMsat !== undefined
        ? t('walletManagement.notifications.paymentSentWithFees', { fees: formatMsat(payment.feesPaidMsat) })
        : t('walletManagement.notifications.paymentSent'),
    );
    paymentDialogOpen.value = false;
    await refreshPaymentHistory();
  } catch (error: unknown) {
    notifyError(error);
    await refreshPaymentHistory();
  } finally {
    payingConnectionId.value = null;
  }
}

function confirmRemoveConnection(connection: Nip47ConnectionSummary): void {
  $q.dialog({
    title: t('walletManagement.removeDialog.title'),
    message: t('walletManagement.removeDialog.message', { label: connection.label }),
    cancel: true,
    persistent: true,
    ok: {
      label: t('walletManagement.actions.remove'),
      color: 'negative',
      unelevated: true,
      noCaps: true,
    },
  }).onOk(() => {
    void removeConnection(connection);
  });
}

async function removeConnection(connection: Nip47ConnectionSummary): Promise<void> {
  loading.value = true;
  try {
    await removeNip47Connection(connection.id);
    notifySuccess(t('walletManagement.notifications.removed'));
    await refreshConnections();
  } catch (error: unknown) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refreshConnections();
});
</script>

<template>
  <q-page class="dashboard-page wallet-connections-page">
    <section class="dashboard-hero wallet-connections-page__hero">
      <div>
        <h1 class="dashboard-hero-title">{{ $t('walletManagement.title') }}</h1>
        <p class="dashboard-hero-caption">
          {{ $t('walletManagement.caption') }}
        </p>
      </div>
      <div class="wallet-connections-page__hero-actions">
        <q-btn
          class="diogel-btn-primary"
          icon="add"
          :label="hasConnections && importPanelVisible ? $t('walletManagement.actions.hideImport') : $t('walletManagement.actions.importWallet')"
          no-caps
          @click="importPanelOpen = !importPanelOpen"
        />
        <q-btn flat round icon="refresh" :loading="loading" @click="refreshConnections" />
      </div>
    </section>

    <q-slide-transition>
      <q-card v-if="importPanelVisible" class="dashboard-card wallet-import-card">
        <q-card-section class="dashboard-card-section wallet-import-card__section">
          <div class="wallet-import-card__intro">
            <div class="text-h6">{{ $t('walletManagement.import.title') }}</div>
            <p class="text-body2 text-grey-7 q-mb-none">
              {{ $t('walletManagement.import.caption') }}
            </p>
          </div>
          <div class="wallet-import-card__form">
            <q-input
              v-model="label"
              outlined
              dense
              :label="$t('walletManagement.import.connectionLabel')"
              :hint="$t('walletManagement.import.connectionHint')"
            />
            <q-input
              v-model="nwcUri"
              outlined
              dense
              type="textarea"
              autogrow
              :label="$t('walletManagement.import.nwcUri')"
              placeholder="nostr+walletconnect://..."
            />
            <div class="wallet-import-card__actions">
              <q-btn
                class="diogel-btn-primary"
                no-caps
                :loading="loading"
                :disable="!nwcUri.trim()"
                :label="$t('walletManagement.actions.importConnection')"
                @click="importConnection"
              />
              <q-btn
                v-if="hasConnections"
                flat
                no-caps
                :label="$t('walletManagement.actions.cancel')"
                @click="importPanelOpen = false"
              />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-slide-transition>

    <div v-if="hasConnections && activeConnection" class="wallet-connections-page__main-grid">
      <q-card class="wallet-active-card">
        <q-card-section class="wallet-active-card__header">
          <div class="wallet-active-card__identity">
            <q-avatar class="wallet-active-card__avatar" size="64px">
              <q-icon name="bolt" size="34px" />
            </q-avatar>
            <div>
              <div class="wallet-active-card__eyebrow">{{ $t('walletManagement.active.eyebrow') }}</div>
              <h2 class="wallet-active-card__title">{{ activeConnection.label }}</h2>
              <div class="wallet-active-card__subtitle">{{ getConnectionSubtitle(activeConnection) }}</div>
            </div>
          </div>
          <q-badge class="wallet-active-card__status" rounded>
            {{ getActiveConnectionStatus(activeConnection) }}
          </q-badge>
        </q-card-section>

        <q-card-section class="wallet-active-card__metrics">
          <button
            class="wallet-active-card__metric wallet-active-card__metric--balance"
            type="button"
            :aria-label="activeBalanceToggleLabel"
            :disabled="activeBalance === undefined"
            @click="toggleBalanceDisplayUnit"
          >
            <span class="wallet-active-card__metric-label">{{ $t('walletManagement.balance.label') }}</span>
            <strong>
              <span v-if="balanceDisplayUnit === 'btc' && activeBalance !== undefined" class="wallet-active-card__bitcoin-symbol">₿</span>
              {{ activeBalanceDisplay }}
              <span v-if="balanceDisplayUnit === 'sats' && activeBalance !== undefined" class="wallet-active-card__balance-unit">sats</span>
            </strong>
            <small>{{ activeBalance !== undefined ? $t('walletManagement.balance.clickToShow', { unit: balanceDisplayUnit === 'btc' ? 'sats' : 'BTC' }) : $t('walletManagement.balance.runCheckFirst') }}</small>
          </button>
          <div class="wallet-active-card__metric wallet-active-card__metric--capabilities" tabindex="0">
            <span class="wallet-active-card__metric-label">{{ $t('walletManagement.capabilities.label') }}</span>
            <strong>{{ activeConnection.capabilities.length }}</strong>
            <small>{{ activeCanPay ? $t('walletManagement.capabilities.payInvoiceEnabled') : $t('walletManagement.capabilities.paymentUnavailable') }}</small>
            <div class="wallet-active-card__capability-panel" role="tooltip">
              <div class="wallet-active-card__capability-panel-title">{{ $t('walletManagement.capabilities.panelTitle') }}</div>
              <ul v-if="activeConnection.capabilities.length > 0" class="wallet-active-card__capability-list">
                <li v-for="capability in activeConnection.capabilities" :key="capability">
                  {{ capability }}
                </li>
              </ul>
              <p v-else class="wallet-active-card__capability-empty">
                {{ $t('walletManagement.capabilities.empty') }}
              </p>
            </div>
          </div>
          <div class="wallet-active-card__metric">
            <span class="wallet-active-card__metric-label">{{ $t('walletManagement.security.label') }}</span>
            <strong>{{ $t('walletManagement.security.vaultStored') }}</strong>
            <small>{{ $t('walletManagement.security.noWebsiteApi') }}</small>
          </div>
        </q-card-section>

        <q-card-section class="wallet-active-card__actions">
          <q-btn
            class="wallet-active-card__pay-button"
            icon="bolt"
            no-caps
            unelevated
            :label="$t('walletManagement.actions.payInvoice')"
            :disable="!activeCanPay"
            :loading="payingConnectionId === activeConnection.id"
            @click="openPaymentDialog(activeConnection)"
          />
          <q-btn
            class="wallet-active-card__secondary-button"
            outline
            no-caps
            :label="$t('walletManagement.actions.balance')"
            :loading="testingConnectionId === activeConnection.id"
            @click="testBalance(activeConnection)"
          />
          <q-btn
            class="wallet-active-card__secondary-button"
            outline
            no-caps
            :label="$t('walletManagement.actions.info')"
            :loading="testingConnectionId === activeConnection.id"
            @click="testInfo(activeConnection)"
          />
        </q-card-section>

        <q-separator dark />

        <q-expansion-item class="wallet-active-card__details" dark dense expand-separator :label="$t('walletManagement.details.technicalDetails')">
          <div class="wallet-details-grid">
            <div>
              <span>{{ $t('walletManagement.details.walletService') }}</span>
              <strong>{{ activeConnection.walletServicePubkey }}</strong>
            </div>
            <div>
              <span>{{ $t('walletManagement.details.clientPubkey') }}</span>
              <strong>{{ activeConnection.clientPubkey }}</strong>
            </div>
            <div>
              <span>{{ $t('walletManagement.details.relays') }}</span>
              <strong>{{ activeConnection.relays.join(', ') }}</strong>
            </div>
            <div>
              <span>{{ $t('walletManagement.details.updated') }}</span>
              <strong>{{ formatTimestamp(activeConnection.updatedAt) }}</strong>
            </div>
          </div>
        </q-expansion-item>
      </q-card>

      <div class="wallet-side-column">
        <q-card class="dashboard-card wallet-secondary-card">
          <q-card-section class="dashboard-card-section wallet-secondary-card__header">
            <div>
              <div class="text-h6">{{ $t('walletManagement.secondary.title') }}</div>
              <div class="text-caption text-grey-7">{{ $t('walletManagement.secondary.caption') }}</div>
            </div>
            <q-badge color="grey-2" text-color="grey-8" :label="$t('walletManagement.secondary.standbyCount', { count: secondaryConnections.length })" />
          </q-card-section>

          <q-card-section v-if="secondaryConnections.length === 0" class="wallet-secondary-card__empty">
            <q-icon name="account_balance_wallet" size="40px" color="grey-5" />
            <div class="text-subtitle2">{{ $t('walletManagement.secondary.emptyTitle') }}</div>
            <p class="text-caption text-grey-7 q-mb-none">{{ $t('walletManagement.secondary.emptyCaption') }}</p>
          </q-card-section>

          <q-list v-else separator>
            <q-expansion-item
              v-for="connection in secondaryConnections"
              :key="connection.id"
              class="wallet-secondary-card__item"
              expand-separator
            >
              <template v-slot:header>
                <q-item-section avatar>
                  <q-avatar color="grey-3" text-color="grey-8" icon="account_balance_wallet" />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ connection.label }}</q-item-label>
                  <q-item-label caption>{{ getConnectionSubtitle(connection) }}</q-item-label>
                  <q-item-label caption>{{ getCapabilitySummary(connection) }}</q-item-label>
                </q-item-section>
              </template>

              <div class="wallet-secondary-card__details q-pa-md">
                <div class="wallet-secondary-card__actions">
                  <q-btn
                    class="diogel-btn-primary"
                    dense
                    no-caps
                    :label="$t('walletManagement.actions.makeActive')"
                    :disable="activationSavePending"
                    @click="makeActive(connection)"
                  />
                  <q-btn dense flat no-caps color="negative" :label="$t('walletManagement.actions.remove')" @click="confirmRemoveConnection(connection)" />
                </div>
                <div class="wallet-details-grid wallet-details-grid--light">
                  <div>
                    <span>{{ $t('walletManagement.details.walletService') }}</span>
                    <strong>{{ connection.walletServicePubkey }}</strong>
                  </div>
                  <div>
                    <span>{{ $t('walletManagement.details.clientPubkey') }}</span>
                    <strong>{{ connection.clientPubkey }}</strong>
                  </div>
                  <div>
                    <span>{{ $t('walletManagement.details.relays') }}</span>
                    <strong>{{ connection.relays.join(', ') }}</strong>
                  </div>
                </div>
              </div>
            </q-expansion-item>
          </q-list>
        </q-card>

        <q-card class="dashboard-card wallet-safety-card">
          <q-card-section class="dashboard-card-section">
            <div class="wallet-safety-card__content">
              <q-icon name="lock" color="primary" size="28px" />
              <div>
                <div class="text-subtitle1 text-weight-bold">{{ $t('walletManagement.safety.title') }}</div>
                <p class="text-caption text-grey-7 q-mb-none">
                  {{ $t('walletManagement.safety.caption') }}
                </p>
              </div>
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <q-card v-else class="dashboard-card wallet-empty-card">
      <q-card-section class="text-center q-pa-xl">
        <q-icon color="grey-5" name="account_balance_wallet" size="4em" />
        <div class="text-h6 text-grey-7 q-mt-md">{{ $t('walletManagement.empty.title') }}</div>
        <p class="text-grey-6">
          {{ $t('walletManagement.empty.caption') }}
        </p>
      </q-card-section>
    </q-card>

    <q-card class="dashboard-card wallet-history-card">
      <q-card-section class="dashboard-card-section wallet-history-card__header">
        <div>
          <div class="text-h6">{{ $t('walletManagement.history.title') }}</div>
          <div class="text-caption text-grey-7">
            {{ $t('walletManagement.history.caption') }}
          </div>
        </div>
        <q-btn flat round icon="refresh" :loading="historyLoading" @click="refreshPaymentHistory" />
      </q-card-section>

      <q-separator />

      <q-card-section v-if="paymentHistory.length === 0" class="wallet-history-card__empty">
        {{ $t('walletManagement.history.empty') }}
      </q-card-section>

      <q-list v-else separator>
        <q-item v-for="entry in paymentHistory" :key="entry.id" class="wallet-history-card__item">
          <q-item-section avatar>
            <q-avatar :color="entry.status === 'succeeded' ? 'positive' : 'negative'" text-color="white" :icon="entry.status === 'succeeded' ? 'check' : 'close'" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="wallet-history-card__item-title">
              {{ entry.connectionLabel }}
              <q-badge :color="entry.status === 'succeeded' ? 'positive' : 'negative'" :label="entry.status" />
            </q-item-label>
            <q-item-label caption>
              {{ formatTimestamp(entry.createdAt) }} · {{ $t('walletManagement.history.amount') }}: {{ entry.amountMsat !== undefined ? formatMsat(entry.amountMsat) : $t('walletManagement.history.unknown') }}
              <span v-if="entry.feesPaidMsat !== undefined">
                · {{ $t('walletManagement.history.fees') }}: {{ formatMsat(entry.feesPaidMsat) }}
              </span>
            </q-item-label>
            <q-item-label v-if="entry.paymentHash" caption>
              {{ $t('walletManagement.history.paymentHash') }}: {{ shortHex(entry.paymentHash) }}
            </q-item-label>
            <q-item-label caption class="break-word">
              {{ $t('walletManagement.history.invoice') }}: {{ entry.invoicePreview }}
            </q-item-label>
            <q-item-label v-if="entry.error" caption class="text-negative break-word">
              {{ $t('walletManagement.history.error') }}: {{ entry.error }}
            </q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>

    <q-dialog v-model="paymentDialogOpen" persistent>
      <q-card class="payment-approval-card">
        <q-card-section>
          <div class="text-h6">{{ $t('walletManagement.payment.title') }}</div>
          <p class="text-body2 text-grey-7 q-mb-none">
            {{ $t('walletManagement.payment.caption') }}
          </p>
        </q-card-section>

        <q-separator />

        <q-card-section class="q-gutter-md">
          <div v-if="selectedPaymentConnection">
            <div class="text-caption text-grey-7">{{ $t('walletManagement.payment.walletConnection') }}</div>
            <div class="text-body1 text-weight-medium">{{ selectedPaymentConnection.label }}</div>
            <div class="text-caption text-grey-7">
              {{ selectedPaymentConnection.lud16 || shortHex(selectedPaymentConnection.walletServicePubkey) }}
            </div>
          </div>

          <q-input
            v-model="paymentInvoice"
            outlined
            type="textarea"
            autogrow
            :label="$t('walletManagement.payment.bolt11Invoice')"
            placeholder="lnbc..."
          />

          <q-card flat bordered class="q-pa-md payment-review-card">
            <div class="text-caption payment-review-label">{{ $t('walletManagement.payment.parsedAmount') }}</div>
            <div class="text-subtitle1 text-weight-bold payment-review-value">{{ parsedInvoiceAmount }}</div>
            <div class="text-caption payment-review-label q-mt-sm">{{ $t('walletManagement.payment.invoicePreview') }}</div>
            <div class="text-body2 break-word payment-review-value">{{ shortInvoice(paymentInvoice) || $t('walletManagement.payment.noInvoiceEntered') }}</div>
          </q-card>

          <q-checkbox
            v-model="paymentApprovalChecked"
            color="negative"
            :label="$t('walletManagement.payment.approvalLabel')"
          />
        </q-card-section>

        <q-card-actions align="right" class="q-pa-md">
          <q-btn
            flat
            no-caps
            :label="$t('walletManagement.actions.cancel')"
            :disable="payingConnectionId !== null"
            @click="paymentDialogOpen = false"
          />
          <q-btn
            unelevated
            no-caps
            color="negative"
            :label="$t('walletManagement.actions.approveAndPay')"
            :loading="payingConnectionId !== null"
            :disable="!paymentInvoice.trim() || !paymentApprovalChecked"
            @click="approvePayment"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
.wallet-connections-page {
  width: 100%;
}

.wallet-connections-page__hero {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.wallet-connections-page__hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.wallet-connections-page__main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.8fr);
  gap: 16px;
  align-items: start;
}

.wallet-import-card__section {
  display: grid;
  grid-template-columns: minmax(220px, 0.7fr) minmax(0, 1.3fr);
  gap: 20px;
  align-items: start;
}

.wallet-import-card__intro p {
  max-width: 560px;
}

.wallet-import-card__form {
  display: grid;
  gap: 14px;
}

.wallet-import-card__actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.wallet-active-card {
  position: relative;
  z-index: 2;
  overflow: visible;
  border-radius: 24px;
  background: #111827;
  color: #ffffff;
  box-shadow: 0 24px 60px rgba(17, 24, 39, 0.22);
}

.wallet-active-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 28px;
}

.wallet-active-card__identity {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
}

.wallet-active-card__avatar {
  background: #f97316;
  color: #111827;
  flex-shrink: 0;
}

.wallet-active-card__eyebrow,
.wallet-active-card__metric-label {
  color: #fbbf24;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.wallet-active-card__title {
  margin: 4px 0;
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 800;
  line-height: 1;
}

.wallet-active-card__subtitle {
  color: #d1d5db;
  font-size: 0.95rem;
}

.wallet-active-card__status {
  padding: 8px 14px;
  background: #dcfce7;
  color: #166534;
  font-weight: 800;
  white-space: nowrap;
}

.wallet-active-card__metrics {
  position: relative;
  z-index: 3;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  padding: 0 28px 22px;
}

.wallet-active-card__metric {
  position: relative;
  display: grid;
  gap: 8px;
  min-height: 116px;
  padding: 18px;
  border: 0;
  border-radius: 18px;
  background: #1f2937;
  color: inherit;
  text-align: left;
}

.wallet-active-card__metric--balance {
  cursor: pointer;
  transition: background 0.18s ease, outline-color 0.18s ease, transform 0.18s ease;
}

.wallet-active-card__metric--balance:not(:disabled):hover,
.wallet-active-card__metric--balance:not(:disabled):focus-visible {
  outline: 2px solid rgba(249, 115, 22, 0.7);
  outline-offset: 2px;
  background: #263244;
  transform: translateY(-1px);
}

.wallet-active-card__metric--balance:disabled {
  cursor: default;
}

.wallet-active-card__metric strong {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: #ffffff;
  font-size: clamp(1.3rem, 2.2vw, 2rem);
  font-weight: 850;
  line-height: 1.05;
}

.wallet-active-card__bitcoin-symbol {
  color: #f97316;
  font-size: 0.92em;
}

.wallet-active-card__balance-unit {
  color: #d1d5db;
  font-size: 0.58em;
  font-weight: 700;
}

.wallet-active-card__metric small {
  color: #d1d5db;
  font-size: 0.82rem;
}

.wallet-active-card__metric--capabilities {
  outline: none;
}

.wallet-active-card__metric--capabilities:hover,
.wallet-active-card__metric--capabilities:focus-visible,
.wallet-active-card__metric--capabilities:focus-within {
  background: #263244;
}

.wallet-active-card__capability-panel {
  position: absolute;
  z-index: 20;
  top: calc(100% - 8px);
  left: 50%;
  display: none;
  width: min(520px, calc(100vw - 48px));
  padding: 14px;
  border: 1px solid rgba(249, 115, 22, 0.45);
  border-radius: 14px;
  background: #111827;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.34);
  color: #f9fafb;
  transform: translateX(-50%);
}

.wallet-active-card__metric--capabilities:hover .wallet-active-card__capability-panel,
.wallet-active-card__metric--capabilities:focus-visible .wallet-active-card__capability-panel,
.wallet-active-card__metric--capabilities:focus-within .wallet-active-card__capability-panel {
  display: block;
}

.wallet-active-card__capability-panel-title {
  margin-bottom: 10px;
  color: #f97316;
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.wallet-active-card__capability-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 22px;
  row-gap: 7px;
  margin: 0;
  padding-left: 18px;
}

.wallet-active-card__capability-list li {
  overflow-wrap: anywhere;
  color: #e5e7eb;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.82rem;
}

.wallet-active-card__capability-empty {
  margin: 0;
  color: #d1d5db;
  font-size: 0.86rem;
  line-height: 1.45;
}

.wallet-active-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 24px 28px 28px;
}

.wallet-active-card__pay-button {
  min-height: 48px;
  padding: 0 22px;
  border-radius: 14px;
  background: #f97316 !important;
  color: #111827 !important;
  font-weight: 900;
}

.wallet-active-card__secondary-button {
  min-height: 48px;
  padding: 0 20px;
  border-radius: 14px;
  color: #ffffff !important;
  border-color: rgba(255, 255, 255, 0.35) !important;
}

.wallet-active-card__details {
  padding: 0 16px 10px;
  color: #e5e7eb;
}

.wallet-details-grid {
  display: grid;
  gap: 12px;
  padding: 14px 12px 20px;
}

.wallet-details-grid div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.wallet-details-grid span {
  color: #9ca3af;
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
}

.wallet-details-grid strong {
  overflow-wrap: anywhere;
  color: #f9fafb;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.82rem;
  font-weight: 600;
}

.wallet-details-grid--light strong {
  color: #374151;
}

.wallet-side-column {
  display: grid;
  gap: 16px;
}

.wallet-secondary-card,
.wallet-safety-card,
.wallet-history-card,
.wallet-empty-card,
.wallet-import-card {
  overflow: hidden;
}

.wallet-secondary-card__header,
.wallet-history-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.wallet-secondary-card__empty,
.wallet-history-card__empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 36px 24px;
  color: #6b7280;
  text-align: center;
}

.wallet-secondary-card__item :deep(.q-item) {
  padding: 14px 20px;
}

.wallet-secondary-card__details {
  display: grid;
  gap: 12px;
  background: rgba(249, 115, 22, 0.06);
}

.wallet-secondary-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wallet-safety-card__content {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.wallet-history-card__item {
  padding: 16px 20px;
}

.wallet-history-card__item-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-weight: 800;
}

.payment-approval-card {
  width: min(560px, 92vw);
}

.break-word {
  word-break: break-all;
}

.payment-review-card {
  background: rgba(249, 115, 22, 0.12);
}

.payment-review-label,
.payment-review-value {
  color: #9a3412;
}

.body--dark .payment-review-card {
  background: rgba(249, 115, 22, 0.2);
  border-color: rgba(251, 146, 60, 0.55);
}

.body--dark .payment-review-label,
.body--dark .payment-review-value {
  color: #fb923c;
}

@media (max-width: 1023px) {
  .wallet-connections-page__hero,
  .wallet-import-card__section {
    grid-template-columns: 1fr;
  }

  .wallet-connections-page__hero {
    align-items: flex-start;
    flex-direction: column;
  }

  .wallet-connections-page__main-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .wallet-active-card__capability-list {
    grid-template-columns: 1fr;
  }

  .wallet-connections-page__hero-actions,
  .wallet-import-card__actions,
  .wallet-active-card__actions,
  .wallet-secondary-card__actions {
    align-items: stretch;
    flex-direction: column;
  }

  .wallet-active-card__header {
    flex-direction: column;
  }

  .wallet-active-card__metrics {
    grid-template-columns: 1fr;
  }
}
</style>
