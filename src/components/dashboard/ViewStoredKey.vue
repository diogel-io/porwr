<script lang="ts" setup>
import type { AccountSummary } from '@/types/accounts';
import { useQuasar } from 'quasar';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import * as nip19 from 'nostr-tools/nip19';
import { revealSecret } from '@/services/dexie-storage';

const $q = useQuasar();
const { t } = useI18n();
defineOptions({ name: 'ViewStoredKey' });
const props = withDefaults(
  defineProps<{
    storedKey: AccountSummary;
    /** Off for an account not yet in the vault, which has no secret to reveal. */
    revealable?: boolean;
  }>(),
  { revealable: true },
);
const showPrivKey = ref(false);
/**
 * The nsec, held only while the user is looking at it (#240). Fetched from the background on the
 * user's explicit "show" or "copy", and dropped on hide and on leaving the page.
 */
const nsec = ref('');

const npub = computed(() => {
  try {
    return nip19.npubEncode(props.storedKey.id);
  } catch {
    return '';
  }
});

async function fetchNsec(): Promise<string> {
  try {
    return await revealSecret(props.storedKey.id);
  } catch {
    $q.notify({ type: 'negative', message: t('account.revealFailed') });
    return '';
  }
}

async function togglePrivKey() {
  if (showPrivKey.value) {
    showPrivKey.value = false;
    nsec.value = '';
    return;
  }
  nsec.value = await fetchNsec();
  showPrivKey.value = nsec.value !== '';
}

async function copyNsec() {
  const secret = nsec.value || (await fetchNsec());
  if (secret) await copyToClipboard(secret);
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
  $q.notify({ type: 'positive', message: t('account.copySuccess') });
}

onBeforeUnmount(() => {
  nsec.value = '';
});
</script>

<template>
  <q-list>
    <q-item tag="label">
      <q-item-section>
        <q-input :model-value="npub" class="text-input" :label="t('account.publicKey')" readonly>
          <template v-slot:prepend>
            <q-icon name="keys" />
          </template>
          <template v-slot:append>
            <q-icon class="cursor-pointer" name="content_copy" @click="copyToClipboard(npub)" />
          </template>
        </q-input>
        <q-input
          v-if="revealable"
          :model-value="showPrivKey ? nsec : '••••••••••••••••'"
          :type="showPrivKey ? 'text' : 'password'"
          class="text-input"
          :label="t('account.privateKey')"
          readonly
        >
          <template v-slot:prepend>
            <q-icon name="keys" />
          </template>
          <template v-slot:append>
            <q-icon
              :name="showPrivKey ? 'visibility_off' : 'visibility'"
              class="cursor-pointer q-mr-sm"
              :aria-label="showPrivKey ? t('account.hidePrivateKey') : t('account.showPrivateKey')"
              @click="togglePrivKey"
            />
            <q-icon
              class="cursor-pointer q-ml-sm"
              name="content_copy"
              :aria-label="t('account.copyPrivateKey')"
              @click="copyNsec"
            />
          </template>
        </q-input>
      </q-item-section>
    </q-item>
  </q-list>
</template>

<style scoped></style>
