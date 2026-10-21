<template>
  <q-dialog v-model="modelValue">
    <q-card style="min-width: 380px; max-width: 90vw">
      <q-card-section>
        <div class="text-h6">{{ t('account.exportAccount') }}</div>
        <div class="text-subtitle2 q-mt-xs">{{ t('account.exportChoosePassword') }}</div>
        <p class="text-caption q-mt-sm q-mb-none">{{ t('account.exportFormatNote') }}</p>
      </q-card-section>

      <q-separator />

      <q-card-section class="q-gutter-md">
        <q-input
          v-model="localVaultPassword"
          :rules="[(v) => !!v || t('account.passwordRequired')]"
          type="password"
          autofocus
          dense
          data-testid="export-vault-password"
          :label="t('account.vaultPassword')"
        />

        <q-input
          v-model="localPassword"
          :rules="[
            (v) => !!v || t('account.passwordRequired'),
            (v) => v.length >= MIN_PASSWORD_LENGTH || t('account.passwordTooShort'),
          ]"
          :type="showPassword ? 'text' : 'password'"
          dense
          data-testid="export-password"
          :label="t('account.password')"
        >
          <template #append>
            <q-icon
              :name="showPassword ? 'visibility_off' : 'visibility'"
              class="cursor-pointer"
              @click="showPassword = !showPassword"
            />
          </template>
        </q-input>

        <q-input
          v-model="localConfirm"
          :rules="[(v) => v === localPassword || t('account.passwordMismatch')]"
          :type="showPassword ? 'text' : 'password'"
          dense
          data-testid="export-password-confirm"
          :label="t('account.confirmPassword')"
        />

        <q-input
          v-model="localFilename"
          :rules="[(v) => !!v || t('account.filenameRequired')]"
          dense
          :label="t('account.filename')"
        />
      </q-card-section>

      <q-separator />

      <q-card-actions align="right">
        <q-btn class="diogel-btn-ghost" :label="t('account.cancel')" @click="onCancel" />
        <q-btn
          class="diogel-btn-primary"
          :label="t('settings.export')"
          :disable="!canConfirm"
          data-testid="export-confirm"
          @click="onConfirm"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { MIN_PASSWORD_LENGTH } from '@/types/accounts';

defineOptions({ name: 'ExportDialog' });

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'confirm', payload: { password: string; vaultPassword: string; filename: string }): void;
}>();

const modelValue = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const localVaultPassword = ref('');
const localPassword = ref('');
const localConfirm = ref('');
const localFilename = ref('');
const showPassword = ref(false);

/**
 * A neutral name: the file holds an encrypted key, and its name should not say whose (#141). The
 * user can rename it.
 */
function defaultFilename(now: Date = new Date()): string {
  return `porwr-key-backup-${now.toISOString().slice(0, 10)}.txt`;
}

const canConfirm = computed(
  () =>
    localVaultPassword.value.length > 0 &&
    localPassword.value.length >= MIN_PASSWORD_LENGTH &&
    localConfirm.value === localPassword.value &&
    localFilename.value.length > 0,
);

watch(
  () => props.modelValue,
  (isOpen) => {
    if (!isOpen) return;
    localVaultPassword.value = '';
    localPassword.value = '';
    localConfirm.value = '';
    localFilename.value = defaultFilename();
  },
  { immediate: true },
);

function onCancel() {
  modelValue.value = false;
}

function onConfirm() {
  if (!canConfirm.value) return;
  emit('confirm', {
    password: localPassword.value,
    vaultPassword: localVaultPassword.value,
    filename: localFilename.value,
  });
  localVaultPassword.value = '';
  localPassword.value = '';
  localConfirm.value = '';
}
</script>

<style scoped></style>
