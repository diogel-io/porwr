<script lang="ts" setup>
import type { StoredKey } from '@/types/';
import { useQuasar } from 'quasar';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import * as nip19 from 'nostr-tools/nip19';
import { hexToBytes } from '@noble/hashes/utils';

const $q = useQuasar();
const { t } = useI18n();
defineOptions({ name: 'ViewStoredKey' });
const props = defineProps<{
  storedKey: StoredKey;
}>();
const showPrivKey = ref(false);

const npub = computed(() => {
  try {
    return nip19.npubEncode(props.storedKey.id);
  } catch {
    return '';
  }
});

const nsec = computed(() => {
  try {
    return nip19.nsecEncode(hexToBytes(props.storedKey.account.privkey));
  } catch {
    return '';
  }
});

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
  $q.notify({ type: 'positive', message: t('account.copySuccess') });
}
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
          :model-value="nsec"
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
              @click="showPrivKey = !showPrivKey"
            />
            <q-icon
              class="cursor-pointer q-ml-sm"
              name="content_copy"
              @click="copyToClipboard(nsec)"
            />
          </template>
        </q-input>
      </q-item-section>
    </q-item>
  </q-list>
</template>

<style scoped></style>
