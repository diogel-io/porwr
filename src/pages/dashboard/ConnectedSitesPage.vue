<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';

import useAccountStore from '@/stores/account-store';
import { getEventKindLabel, getRequestTypeLabel } from '@/services/approval-preview';
import {
  disconnectSite,
  listConnectedSites,
  type ConnectedSite,
} from '@/services/connected-sites-service';

defineOptions({ name: 'ConnectedSitesPage' });

const $q = useQuasar();
const { t, d } = useI18n();
const accountStore = useAccountStore();

const sites = ref<ConnectedSite[]>([]);
const loading = ref(true);
const disconnecting = ref<string | null>(null);

const hasSites = computed(() => sites.value.length > 0);

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    sites.value = await listConnectedSites();
  } catch {
    $q.notify({ type: 'negative', message: t('dashboard.connectedSites.loadFailed') });
  } finally {
    loading.value = false;
  }
}

/**
 * Disconnecting is all-or-nothing and confirmed first.
 *
 * It is not destructive in the sense of losing data, but it does end a session the user may be in
 * the middle of, so it is worth asking before doing.
 */
function confirmDisconnect(site: ConnectedSite): void {
  $q.dialog({
    title: t('dashboard.connectedSites.disconnectTitle', { origin: site.origin }),
    message: t('dashboard.connectedSites.disconnectBody'),
    ok: { label: t('dashboard.connectedSites.disconnectConfirm'), color: 'negative', noCaps: true },
    cancel: { label: t('dashboard.connectedSites.disconnectCancel'), flat: true, noCaps: true },
    persistent: true,
  }).onOk(() => {
    void disconnect(site);
  });
}

async function disconnect(site: ConnectedSite): Promise<void> {
  disconnecting.value = site.origin;
  try {
    const done = await disconnectSite(site.origin);
    if (!done) {
      $q.notify({
        type: 'negative',
        message: t('dashboard.connectedSites.disconnectFailed', { origin: site.origin }),
      });
      return;
    }

    $q.notify({
      type: 'positive',
      message: t('dashboard.connectedSites.disconnected', { origin: site.origin }),
    });
    await refresh();
  } finally {
    disconnecting.value = null;
  }
}

/** The bound account's alias, when it is still in the vault. Bindings are keyed by key, not alias. */
const aliasFor = (pubkey: string): string | null =>
  Array.from(accountStore.storedKeys).find((key) => key.id === pubkey)?.alias ?? null;

/**
 * A site keeps the account it connected with, whichever account is active (#116). Saying when that
 * is not the active one is what makes "it signed as the wrong user" explicable (workspace#23).
 */
const isNotActive = (pubkey: string): boolean => {
  const active = accountStore.activeAccount;
  return active !== undefined && active.id !== pubkey;
};

/** Public keys are shown truncated: enough to tell two identities apart, not enough to swamp a row. */
const shortPubkey = (pubkey: string): string => `${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`;

const grantLabel = (requestType: string, eventKind: number | 'any' | null): string => {
  if (eventKind === 'any') return `${getRequestTypeLabel(requestType)} · any kind`;
  if (eventKind === null) return getRequestTypeLabel(requestType);
  return `${getRequestTypeLabel(requestType)} · ${getEventKindLabel(eventKind)}`;
};

onMounted(() => {
  void refresh();
  void accountStore.getKeys();
});
</script>

<template>
  <q-page class="dashboard-page-shell">
    <header class="connected-sites__header">
      <h1 class="text-h5">{{ t('dashboard.connectedSites.title') }}</h1>
      <p class="text-grey-7">{{ t('dashboard.connectedSites.caption') }}</p>
    </header>

    <q-inner-loading :showing="loading" />

    <div v-if="!loading && !hasSites" class="connected-sites__empty">
      <q-icon color="grey-5" name="link_off" size="3em" />
      <p class="text-subtitle1 q-mt-sm">{{ t('dashboard.connectedSites.empty') }}</p>
      <p class="text-grey-6">{{ t('dashboard.connectedSites.emptyHint') }}</p>
    </div>

    <div v-else class="connected-sites__list">
      <q-card v-for="site in sites" :key="site.origin" flat bordered class="connected-sites__card">
        <q-card-section class="connected-sites__row">
          <div class="connected-sites__detail">
            <div class="connected-sites__origin">{{ site.origin }}</div>

            <div class="connected-sites__identity">
              <template v-if="site.boundPubkey">
                {{ t('dashboard.connectedSites.signsAs') }}
                <strong v-if="aliasFor(site.boundPubkey)" data-testid="bound-alias">
                  {{ aliasFor(site.boundPubkey) }}
                </strong>
                <code>{{ shortPubkey(site.boundPubkey) }}</code>
                <q-badge
                  v-if="isNotActive(site.boundPubkey)"
                  outline
                  color="warning"
                  class="q-ml-xs"
                  data-testid="not-active"
                  :label="t('dashboard.connectedSites.notActive')"
                />
              </template>
              <span v-else class="text-grey-6">
                {{ t('dashboard.connectedSites.unbound') }}
              </span>
            </div>

            <div v-if="site.boundAt" class="connected-sites__meta">
              {{ t('dashboard.connectedSites.connectedOn') }} {{ d(new Date(site.boundAt), 'short') }}
            </div>
          </div>

          <q-btn
            no-caps
            outline
            color="negative"
            :loading="disconnecting === site.origin"
            :label="t('dashboard.connectedSites.disconnect')"
            @click="confirmDisconnect(site)"
          />
        </q-card-section>

        <q-separator />

        <q-card-section>
          <div class="connected-sites__grants-label">
            {{ t('dashboard.connectedSites.grants') }}
          </div>

          <!-- A site with no standing permission is asked every time, which is worth saying rather
               than showing an empty space. -->
          <div v-if="site.grants.length === 0" class="text-grey-6">
            {{ t('dashboard.connectedSites.noGrants') }}
          </div>

          <ul v-else class="connected-sites__grants">
            <li v-for="grant in site.grants" :key="`${grant.requestType}-${String(grant.eventKind)}`">
              <span>{{ grantLabel(grant.requestType, grant.eventKind) }}</span>
              <span class="connected-sites__expiry">
                {{
                  grant.expiresAt
                    ? `${t('dashboard.connectedSites.expires')} ${d(new Date(grant.expiresAt), 'short')}`
                    : t('dashboard.connectedSites.neverExpires')
                }}
              </span>
            </li>
          </ul>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<style scoped>
.connected-sites__header {
  margin-bottom: 16px;
}

.connected-sites__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.connected-sites__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.connected-sites__detail {
  min-width: 0;
}

/* Origins can be long and must not push the disconnect control off the card. */
.connected-sites__origin {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.connected-sites__identity {
  font-size: 0.85rem;
  margin-top: 4px;
}

.connected-sites__meta {
  font-size: 0.75rem;
  color: var(--text-muted, #888);
  margin-top: 4px;
}

.connected-sites__grants-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #888);
  margin-bottom: 6px;
}

.connected-sites__grants {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.connected-sites__grants li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.85rem;
}

.connected-sites__expiry {
  color: var(--text-muted, #888);
  white-space: nowrap;
}

.connected-sites__empty {
  text-align: center;
  padding: 48px 16px;
}
</style>
