<script lang="ts" setup>
import { ref } from 'vue';
import { exportFile, useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { StoredKey } from '@/types';
import ExportDialog from '@/components/dashboard/ExportDialog.vue';
import { createEncryptedZipBytes, ZIP_MIME_TYPE } from '@/services/compressor';

defineOptions({ name: 'ExportButton' });

const props = defineProps<{
  storedKey: StoredKey;
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

  const zipBytes = await createEncryptedZipBytes(
    payload.password,
    payload.filename,
    props.storedKey,
  );

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
