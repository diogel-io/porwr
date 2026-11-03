<script lang="ts" setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { type QInput, useQuasar } from 'quasar';
import { useRouter } from 'vue-router';

import { sendBexMessage } from '@/services/bridge-client';
import useAccountStore from '@/stores/account-store';
import type { Nip46AuthChallengeView } from '@/types/nip46';

/**
 * Connect an account held by a NIP-46 remote signer from its `bunker://` URI (#138).
 *
 * The URI goes to the background, which makes the client key and talks to the signer; this page
 * never holds a key. A signer may ask the user to authorise Porwr while it connects: the request is
 * shown here as a link the user clicks, and the background opens the URL it checked.
 */

defineOptions({ name: 'RemoteSignerForm' });

const { t } = useI18n();
const $q = useQuasar();
const router = useRouter();
const accountStore = useAccountStore();

const aliasInputRef = ref<QInput | null>(null);
const bunkerUri = ref('');
const alias = ref('');
const connecting = ref(false);
const challenges = ref<Nip46AuthChallengeView[]>([]);

const trimmedUri = computed(() => bunkerUri.value.trim());
const trimmedAlias = computed(() => alias.value.trim());
const looksLikeBunkerUri = computed(() => trimmedUri.value.toLowerCase().startsWith('bunker://'));

/** While connecting, the background is asked about challenges once a second. */
const CHALLENGE_POLL_MS = 1000;
let poller: ReturnType<typeof setInterval> | undefined;

const stopPolling = (): void => {
  if (poller !== undefined) clearInterval(poller);
  poller = undefined;
  challenges.value = [];
};

const readChallenges = async (): Promise<void> => {
  try {
    const all = await sendBexMessage('nip46.authChallenges');
    // A connection has no site behind it; a site's challenges belong to the panel.
    if (connecting.value && Array.isArray(all)) {
      challenges.value = all.filter((challenge) => !challenge.origin);
    }
  } catch {
    /* read again on the next tick */
  }
};

function openChallenge(challenge: Nip46AuthChallengeView): void {
  void sendBexMessage('nip46.openAuthChallenge', { challengeId: challenge.id });
}

async function connect(): Promise<void> {
  if (!trimmedAlias.value) {
    $q.notify({ type: 'negative', message: String(t('validation.profileNameRequired')) });
    aliasInputRef.value?.focus?.();
    return;
  }
  if (!looksLikeBunkerUri.value || connecting.value) return;

  connecting.value = true;
  poller = setInterval(() => void readChallenges(), CHALLENGE_POLL_MS);
  try {
    const account = await accountStore.connectRemoteSigner({
      alias: trimmedAlias.value,
      bunkerUri: trimmedUri.value,
    });
    bunkerUri.value = '';
    $q.notify({ type: 'positive', message: String(t('keyManagement.remoteSigner.connected')) });
    await router.push({ name: 'view-key', params: { alias: account.alias } });
  } catch (error: unknown) {
    $q.notify({
      type: 'negative',
      message: t('keyManagement.remoteSigner.failed', {
        error: error instanceof Error ? error.message : String(error),
      }),
    });
  } finally {
    connecting.value = false;
    stopPolling();
  }
}

onBeforeUnmount(() => {
  stopPolling();
  bunkerUri.value = '';
});
</script>

<template>
  <div class="q-pa-lg-lg full-width settings-form rounded-borders" data-testid="remote-signer-form">
    <div class="text-h6">{{ t('keyManagement.remoteSigner.title') }}</div>
    <p class="text-grey-7">{{ t('keyManagement.remoteSigner.caption') }}</p>
    <div class="q-gutter-lg">
      <q-input
        v-model="bunkerUri"
        :label="t('keyManagement.remoteSigner.uriLabel')"
        :hint="t('keyManagement.remoteSigner.uriHint')"
        :disable="connecting"
        autocomplete="off"
        data-testid="remote-signer-uri"
        class="text-input"
      />
      <q-input
        ref="aliasInputRef"
        v-model="alias"
        :label="t('account.profileName')"
        :disable="connecting"
        data-testid="remote-signer-alias"
        class="text-input"
      />
      <q-btn
        :disable="!looksLikeBunkerUri || connecting"
        :loading="connecting"
        :label="t('keyManagement.remoteSigner.connect')"
        class="diogel-btn-primary"
        data-testid="remote-signer-connect"
        @click="connect"
      />
      <div v-if="connecting" class="text-caption text-grey-7" role="status">
        {{ t('keyManagement.remoteSigner.connecting') }}
      </div>
      <q-banner
        v-for="challenge in challenges"
        :key="challenge.id"
        rounded
        data-testid="remote-signer-form-auth"
      >
        <div class="text-weight-medium">{{ t('keyManagement.remoteSigner.authTitle') }}</div>
        <div class="remote-signer-form__url text-caption">{{ challenge.url }}</div>
        <template #action>
          <q-btn
            class="diogel-btn-primary"
            no-caps
            :label="t('keyManagement.remoteSigner.authOpen', { host: challenge.host })"
            @click="openChallenge(challenge)"
          />
        </template>
      </q-banner>
    </div>
  </div>
</template>

<style scoped>
.remote-signer-form__url {
  overflow-wrap: anywhere;
  font-family: monospace;
}
</style>
