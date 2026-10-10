<script lang="ts" setup>
import { ref } from 'vue';
import { exportFile, useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { AccountSummary } from '@/types/accounts';
import { revealSecret } from '@/services/dexie-storage';
import ExportDialog from '@/components/dashboard/ExportDialog.vue';
import { createEncryptedZipBytes, ZIP_MIME_TYPE } from '@/services/compressor';

defineOptions({ name: 'ExportButton' });

const props = defineProps<{
  storedKey: AccountSummary;
}>();

const $q = useQuasar();
const { t } = useI18n();
const showExportDialog = ref(false);

type ExportPayload = { password: string; filename: string };

function notifyExportStarted() {
  $q.notify({
    type: 'positive',
    message: t('account.exportStarted'),
  });
}

function onExportClick() {
  showExportDialog.value = true;
}

async function onExportConfirm(payload: ExportPayload) {
  showExportDialog.value = false;

  let zipBytes: ArrayBuffer;
  try {
    // Revealed only for this export, after the user confirmed it, and not kept (#240).
    const nsec = await revealSecret(props.storedKey.id);
    zipBytes = await createEncryptedZipBytes(payload.password, payload.filename, props.storedKey, nsec);
  } catch {
    $q.notify({ type: 'negative', message: t('account.exportFailed') });
    return;
  }

  const didStartExport = exportFile(payload.filename, zipBytes, ZIP_MIME_TYPE);
  if (!didStartExport) return;

  notifyExportStarted();
}
</script>

<template>
  <q-btn
    class="diogel-btn-primary"
    dense
    :label="t('settings.export')"
    @click="onExportClick"
  />

  <ExportDialog
    v-model="showExportDialog"
    :alias="props.storedKey.alias.trim()"
    @confirm="onExportConfirm"
  />
</template>
