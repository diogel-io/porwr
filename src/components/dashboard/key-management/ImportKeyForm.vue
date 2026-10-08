<script lang="ts" setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { type QInput, useQuasar } from 'quasar';
import { useRouter } from 'vue-router';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';

import ViewStoredKey from '@/components/dashboard/ViewStoredKey.vue';
import useAccountStore from '@/stores/account-store';
import type { Account, StoredKey } from '@/types';

const { t } = useI18n();
const $q = useQuasar();
const router = useRouter();
const accountStore = useAccountStore();

const aliasInputRef = ref<QInput | null>(null);
const importNsec = ref('');
const importedReady = ref(false);
const storedKey = ref<StoredKey>({
  id: '',
  alias: '',
  createdAt: '',
  account: {
    privkey: '',
  },
});

const isValidNsec = computed<boolean>(() => {
  const val = importNsec.value.trim();
  if (!val) return false;
  try {
    const decoded = nip19.decode(val);
    return decoded.type === 'nsec' && !!decoded.data;
  } catch {
    return false;
  }
});

const trimmedAlias = computed(() => storedKey.value.alias.trim());

function onImportClick(): void {
  if (!isValidNsec.value) return;
  try {
    const decoded = nip19.decode(importNsec.value.trim());
    if (decoded.type !== 'nsec') return;
    const sk = decoded.data;
    const pk = getPublicKey(sk);
    const account: Account = {
      privkey: bytesToHex(sk),
    };
    storedKey.value = {
      id: pk,
      alias: '',
      account,
      createdAt: new Date().toISOString(),
    };
    importedReady.value = true;
  } catch {
    $q.notify({ type: 'negative', message: String(t('validation.invalidNsec')) });
  }
}

function notifyMissingAlias() {
  $q.notify({ type: 'negative', message: String(t('validation.profileNameRequired')) });
}

function validate() {
  if (!trimmedAlias.value) {
    notifyMissingAlias();
    aliasInputRef.value?.focus?.();
    return false;
  }
  if (trimmedAlias.value === t('account.mainAccountReserved')) {
    $q.notify({
      type: 'negative',
      message: t('account.mainAccountReservedError', { name: t('account.mainAccountReserved') }),
    });
    aliasInputRef.value?.focus?.();
    return false;
  }
  return true;
}

async function saveKey() {
  if (!validate()) return;

  try {
    storedKey.value.alias = trimmedAlias.value;
    await accountStore.saveKey(storedKey.value);
    await router.push({ name: 'view-key', params: { alias: storedKey.value.alias } });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : String(t('validation.keyPairExists'));

    $q.notify({
      type: 'negative',
      message: errorMessage,
    });
  }
}
</script>

<template>
  <div class="q-pa-lg-lg full-width settings-form rounded-borders">
    <div class="q-gutter-lg">
      <q-input
        v-model="importNsec"
        :label="t('createAccount.importNsecLabel')"
        :rules="[(v) => (!!String(v ?? '').trim() && isValidNsec) || String(t('validation.invalidNsec'))]"
        clearable
        lazy-rules
      />
      <q-btn
        :disable="!isValidNsec"
        :label="t('createAccount.importButton')"
        class="diogel-btn-primary"
        @click="onImportClick"
      />
    </div>

    <div v-if="importedReady" class="q-gutter-lg q-mt-xl">
      <q-input
        ref="aliasInputRef"
        v-model="storedKey.alias"
        :label="t('account.profileName')"
        :rules="[(v) => !!String(v ?? '').trim() || String(t('validation.profileNameRequired'))]"
        class="text-input"
        lazy-rules
      >
        <template v-slot:prepend>
          <q-icon name="person" />
        </template>
        <template v-slot:append>
          <q-icon class="cursor-pointer q-ml-xs" name="help_outline">
            <q-tooltip
              :offset="[0, 10]"
              anchor="bottom end"
              class="text-body1 text-primary"
              self="top middle"
            >
              {{ t('account.aliasToolTip') }}
            </q-tooltip>
          </q-icon>
        </template>
      </q-input>

      <view-stored-key :stored-key="storedKey" />

      <q-btn
        :label="t('createAccount.save')"
        class="full-width diogel-btn-primary"
        dense
        size="lg"
        @click="saveKey"
      />
    </div>
  </div>
</template>

<style scoped></style>
