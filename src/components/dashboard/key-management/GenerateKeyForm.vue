<script lang="ts" setup>
import { computed, ref } from 'vue';
import { type QInput, useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import type { StoredKey } from '@/types';
import useAccountStore from '@/stores/account-store';
import { generateKey } from '@/services/generate-key';
import ViewStoredKey from '@/components/dashboard/ViewStoredKey.vue';

const { t } = useI18n();
const $q = useQuasar();
const router = useRouter();
const store = useAccountStore();

const aliasInputRef = ref<QInput | null>(null);
const showGenerateKeys = ref(false);
const storedKey = ref<StoredKey>({
  id: '',
  alias: '',
  createdAt: '',
  account: {
    privkey: '',
  },
});

const trimmedAlias = computed(() => storedKey.value.alias.trim());

function onGenerateKeysClick(): void {
  showGenerateKeys.value = true;
  storedKey.value = generateKey();
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

  const alias = trimmedAlias.value;
  storedKey.value.alias = alias;

  try {
    await store.saveKey(storedKey.value);
    await router.push({ name: 'view-key', params: { alias } });
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
  <div
    v-if="!showGenerateKeys"
    class="flex justify-center q-pa-lg-lg full-width settings-form rounded-borders"
  >
    <q-btn
      :label="t('createAccount.generateKeys')"
      class="diogel-btn-primary"
      @click="onGenerateKeysClick"
    />
  </div>

  <div
    v-else
    id="generate-keys"
    class="q-pa-lg-lg full-width settings-form rounded-borders"
  >
    <q-list>
      <q-item>
        <q-item-section>
          <div class="q-gutter-lg">
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
          </div>

          <div class="row q-gutter-lg items-center q-mt-lg">
            <q-btn
              :label="t('createAccount.save')"
              class="full-width diogel-btn-primary"
              dense
              size="lg"
              @click="saveKey"
            />
          </div>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<style scoped></style>
