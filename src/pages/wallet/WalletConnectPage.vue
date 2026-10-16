<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';

import DiogelLogo from '@/components/shared/DiogelLogo.vue';
import { useWalletAuthorization } from '@/composables/useWalletAuthorization';
import { postWalletConnectOutcome, type WalletConnectOutcome } from '@/services/wallet-connect-channel';
import { WALLET_PROVIDERS, createWalletProviderId } from '@/types/wallet-provider';
import { createPubkey } from '@/types/pubkey';

/**
 * The throwaway window that opens a wallet's approval popup (workspace#76).
 *
 * The wallet's popup can navigate this window through `window.opener`, so it holds nothing worth
 * taking: no navigation, no vault content, and of the account only its public key, which says whose
 * wallet this connection becomes (#304). It runs one connection, tells Wallet
 * Connections how it ended, and closes. See `useWalletConnectWindow` for the other side.
 */
defineOptions({ name: 'WalletConnectPage' });

type ConnectState = 'opening' | 'needs-click' | 'waiting' | 'finished' | 'invalid';

const route = useRoute();
const { t } = useI18n();
const { connect } = useWalletAuthorization();

const queryValue = (key: string): string | undefined => {
  const value = route.query[key];
  return typeof value === 'string' && value ? value : undefined;
};

const providerId = createWalletProviderId(queryValue('provider'));
const requestId = queryValue('request');
const customOrigin = queryValue('origin');
const accountPubkey = createPubkey(queryValue('account') ?? '');
const providerName = providerId ? WALLET_PROVIDERS[providerId].name : '';

// No account, no connection: falling back to the active one is how every account came to share a
// wallet, and the user may have switched account since Wallet Management opened this window.
const state = ref<ConnectState>(providerId && requestId && accountPubkey ? 'opening' : 'invalid');
const message = computed(() => {
  switch (state.value) {
    case 'opening':
      return t('walletManagement.connectWindow.opening', { provider: providerName });
    case 'needs-click':
      return t('walletManagement.connectWindow.needsClick', { provider: providerName });
    case 'waiting':
      return t('walletManagement.connectWindow.waiting', { provider: providerName });
    case 'finished':
      return t('walletManagement.connectWindow.finished');
    default:
      return t('walletManagement.connectWindow.invalid');
  }
});

async function closeSelf(): Promise<void> {
  try {
    const current = await chrome.windows.getCurrent();
    if (current.id !== undefined) {
      await chrome.windows.remove(current.id);
    }
  } catch {
    // The finished state stays on screen, so the user can close the window themselves.
  }
}

async function finish(outcome: WalletConnectOutcome): Promise<void> {
  state.value = 'finished';
  postWalletConnectOutcome(requestId!, outcome);
  await closeSelf();
}

/**
 * Opens the wallet's popup and sees the connection through.
 *
 * Chromium lets an extension window open a popup without a click, so on load this normally goes
 * straight to the wallet. If the browser blocks it anyway, the page asks for one click and tries
 * again from that.
 */
async function start(fromClick: boolean): Promise<void> {
  if (!providerId || !requestId || !accountPubkey) {
    return;
  }

  state.value = 'waiting';
  try {
    const result = await connect(providerId, accountPubkey, customOrigin);
    if (result.status === 'popup-blocked' && !fromClick) {
      state.value = 'needs-click';
      return;
    }
    await finish(result);
  } catch (error: unknown) {
    await finish({ status: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

onMounted(() => {
  void start(false);
});
</script>

<template>
  <q-page class="q-pa-md flex flex-center wallet-connect-page">
    <div class="full-width q-pa-sm" style="max-width: 380px">
      <q-card bordered class="shadow-2" flat>
        <q-card-section class="flex flex-center q-pt-lg q-pb-none">
          <DiogelLogo size="lg" />
        </q-card-section>

        <q-card-section class="text-center">
          <div class="text-h6">{{ t('walletManagement.connectWindow.title', { provider: providerName }) }}</div>
          <p class="q-mt-sm q-mb-none" data-testid="wallet-connect-message">{{ message }}</p>
        </q-card-section>

        <q-card-section v-if="state === 'opening' || state === 'waiting'" class="flex flex-center">
          <q-spinner size="md" color="primary" />
        </q-card-section>

        <q-card-actions v-if="state === 'needs-click'" align="center" class="q-pb-lg">
          <q-btn
            color="primary"
            no-caps
            unelevated
            data-testid="wallet-connect-continue"
            :label="t('walletManagement.connectWindow.continue', { provider: providerName })"
            @click="start(true)"
          />
        </q-card-actions>
      </q-card>
    </div>
  </q-page>
</template>

<style scoped></style>
