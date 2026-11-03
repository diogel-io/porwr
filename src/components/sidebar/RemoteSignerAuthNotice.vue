<script lang="ts" setup>
import { useI18n } from 'vue-i18n';

import { sendBexMessage } from '@/services/bridge-client';
import type { Nip46AuthChallengeView } from '@/types/nip46';

/**
 * A remote signer asking the user to authorise Porwr before it answers (#138, T39).
 *
 * Shown as text: the URL's host and the URL itself. Nothing at it is fetched to present it, and it
 * opens in a new tab only when the user clicks (D13). The page names the challenge by id, so the
 * background opens the URL it checked, not one the panel holds.
 */

defineOptions({ name: 'RemoteSignerAuthNotice' });

defineProps<{ challenges: Nip46AuthChallengeView[] }>();

const { t } = useI18n();

function open(challenge: Nip46AuthChallengeView): void {
  void sendBexMessage('nip46.openAuthChallenge', { challengeId: challenge.id });
}
</script>

<template>
  <section class="remote-signer-auth" role="status" data-testid="remote-signer-auth">
    <q-banner
      v-for="challenge in challenges"
      :key="challenge.id"
      class="remote-signer-auth__item q-mb-sm"
      rounded
    >
      <div class="text-weight-medium">{{ t('sidebar.remoteSignerAuth.title') }}</div>
      <div class="text-caption">
        {{
          challenge.origin
            ? t('sidebar.remoteSignerAuth.forSite', { origin: challenge.origin })
            : t('sidebar.remoteSignerAuth.forConnect')
        }}
      </div>
      <div class="remote-signer-auth__url text-caption">{{ challenge.url }}</div>
      <div class="text-caption text-grey-7">{{ t('sidebar.remoteSignerAuth.hint') }}</div>
      <template #action>
        <q-btn
          class="diogel-btn-primary"
          no-caps
          :label="t('sidebar.remoteSignerAuth.open', { host: challenge.host })"
          data-testid="remote-signer-auth-open"
          @click="open(challenge)"
        />
      </template>
    </q-banner>
  </section>
</template>

<style scoped>
.remote-signer-auth__url {
  overflow-wrap: anywhere;
  font-family: monospace;
}
</style>
