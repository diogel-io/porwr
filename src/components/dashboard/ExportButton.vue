<script lang="ts" setup>
import { ref } from 'vue';
import { exportFile, useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { AccountSummary } from '@/types/accounts';
import { exportEncryptedKey } from '@/services/dexie-storage';
import ExportDialog from '@/components/dashboard/ExportDialog.vue';
import { formatEncryptedKeyBackup } from '@/services/key-backup';

defineOptions({ name: 'ExportButton' });

const props = defineProps<{
  storedKey: AccountSummary;
}>();

const $q = useQuasar();
const { t } = useI18n();
const showExportDialog = ref(false);
const exporting = ref(false);

type ExportPayload = { password: string; filename: string };

function onExportClick() {
  showExportDialog.value = true;
}

/**
 * Exports the key as a NIP-49 `ncryptsec`, encrypted in the background with the password the user
 * chose. The page never receives the nsec (#141).
 */
async function onExportConfirm(payload: ExportPayload) {
  showExportDialog.value = false;
  exporting.value = true;

  let text: string;
  try {
    const exported = await exportEncryptedKey(props.storedKey.id, payload.password);
    text = formatEncryptedKeyBackup(exported);
  } catch {
    $q.notify({ type: 'negative', message: t('account.exportFailed') });
    return;
  } finally {
    exporting.value = false;
  }

  if (!exportFile(payload.filename, text, 'text/plain')) return;
  $q.notify({ type: 'positive', message: t('account.exportStarted') });
}
</script>

<template>
  <q-btn
    class="diogel-btn-primary"
    dense
    :label="t('settings.export')"
    :loading="exporting"
    @click="onExportClick"
  />

  <ExportDialog v-model="showExportDialog" @confirm="onExportConfirm" />
</template>
