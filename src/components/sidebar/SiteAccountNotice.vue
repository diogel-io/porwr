<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';

import {
  getSiteAccount,
  switchSiteToActiveAccount,
  type SiteAccount,
} from '@/services/connected-sites-service';

defineOptions({ name: 'SiteAccountNotice' });

/**
 * Which account the site in the active tab is connected as, and a way to move it.
 *
 * A site keeps the account it first connected with, whichever account is active later (#116).
 * Selecting another account changed nothing for that site and nothing said so, which looked like
 * Porwr signing as the wrong user (diogel-io/workspace#23).
 */
const props = defineProps<{
  origin: string;
  /** The active account's public key, so the comparison is redone when it changes. */
  activePubkey: string | null;
}>();

const $q = useQuasar();
const { t } = useI18n();

const site = ref<SiteAccount | null>(null);
const switching = ref(false);

const shortPubkey = (pubkey: string): string => `${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`;

const boundName = computed(() => {
  if (!site.value) return '';
  return site.value.boundAlias ?? t('sidebar.activeSite.unknownAccount');
});

const activeName = computed(() => {
  if (!site.value?.activePubkey) return '';
  return site.value.activeAlias ?? shortPubkey(site.value.activePubkey);
});

async function load(): Promise<void> {
  site.value = props.origin ? await getSiteAccount(props.origin) : null;
}

watch(() => [props.origin, props.activePubkey], load, { immediate: true });

/** Confirmed first: it ends the site's session as the old account and removes its permissions. */
function confirmUseActive(): void {
  const current = site.value;
  if (!current) return;
  const names = { origin: current.origin, active: activeName.value };

  $q.dialog({
    title: t('sidebar.activeSite.useActiveTitle', names),
    message: t('sidebar.activeSite.useActiveBody', names),
    ok: { label: t('sidebar.activeSite.useActiveConfirm', names), color: 'primary', noCaps: true },
    cancel: { label: t('sidebar.activeSite.useActiveCancel'), flat: true, noCaps: true },
    persistent: true,
  }).onOk(() => {
    void useActive(names);
  });
}

async function useActive(names: { origin: string; active: string }): Promise<void> {
  switching.value = true;
  try {
    const result = await switchSiteToActiveAccount(names.origin);
    if (!result.success) {
      $q.notify({ type: 'negative', message: t('request.account.switchFailed', names) });
      return;
    }
    site.value = result.site;
    $q.notify({ type: 'positive', message: t('request.account.switched', names) });
  } finally {
    switching.value = false;
  }
}
</script>

<template>
  <div v-if="site" class="site-account" data-testid="site-account">
    <div class="site-account__bound" data-testid="site-account-bound">
      {{ t('sidebar.activeSite.connectedAs', { account: boundName }) }}
    </div>

    <div
      v-if="site.mismatch"
      class="site-account__mismatch"
      role="alert"
      data-testid="site-account-mismatch"
    >
      <q-icon name="warning" size="xs" />
      <span>
        {{
          t('sidebar.activeSite.mismatch', {
            origin: site.origin,
            bound: boundName,
            active: activeName,
          })
        }}
      </span>
    </div>

    <q-btn
      v-if="site.mismatch"
      no-caps
      outline
      size="sm"
      color="primary"
      data-testid="site-account-use-active"
      :loading="switching"
      :label="t('sidebar.activeSite.useActive', { active: activeName })"
      @click="confirmUseActive"
    />
  </div>
</template>

<style scoped>
.site-account {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  min-width: 0;
}

.site-account__bound {
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.site-account__mismatch {
  display: flex;
  gap: 4px;
  align-items: flex-start;
  font-size: 0.8rem;
  color: var(--q-warning, #b26a00);
  overflow-wrap: anywhere;
}
</style>
