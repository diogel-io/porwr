<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { uploadImageToBlossom } from '@/services/blossom-upload-service';
import { storageService } from '@/services/storage-service';
import type { StoredKey } from '@/types';

defineOptions({ name: 'ImageUploader' });

const props = defineProps<{
  storedKey: StoredKey;
  label?: string;
  uploadId?: string;
}>();

const emit = defineEmits<{
  (e: 'uploaded', url: string): void;
  (e: 'uploading', status: boolean): void;
  (e: 'avatar-uploaded', url: string): void;
  (e: 'avatar-uploading', status: boolean): void;
  (e: 'banner-uploaded', url: string): void;
  (e: 'banner-uploading', status: boolean): void;
}>();

const $q = useQuasar();
const { t } = useI18n();

const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const lastUploadedUrl = ref<string | null>(null);

interface StorageUploadStatus {
  uploading?: boolean;
  url?: string;
  error?: string;
}

function isUploadStatus(value: unknown): value is StorageUploadStatus {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const hasValidUploading = record.uploading === undefined || typeof record.uploading === 'boolean';
  const hasValidUrl = record.url === undefined || typeof record.url === 'string';
  const hasValidError = record.error === undefined || typeof record.error === 'string';

  return hasValidUploading && hasValidUrl && hasValidError;
}

const BLOSSOM_UPLOAD_STATUS = props.uploadId
  ? `blossom:upload_status:${props.uploadId}`
  : 'blossom:upload_status';

function emitStatus(type: 'uploading' | 'uploaded', value: boolean | string) {
  if (type === 'uploading') {
    emit('uploading', value as boolean);
  } else {
    emit('uploaded', value as string);
  }

  if (props.uploadId) {
    if (props.uploadId === 'avatar') {
      if (type === 'uploading') {
        emit('avatar-uploading', value as boolean);
      } else {
        emit('avatar-uploaded', value as string);
      }
    } else if (props.uploadId === 'banner') {
      if (type === 'uploading') {
        emit('banner-uploading', value as boolean);
      } else {
        emit('banner-uploaded', value as string);
      }
    }
  }
}

function emitUploadedOnce(url: string) {
  if (lastUploadedUrl.value === url) return;
  lastUploadedUrl.value = url;
  emitStatus('uploaded', url);
}

async function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0 && target.files[0]) {
    await uploadImage(target.files[0]);
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read image file'));
        return;
      }

      const [, base64] = reader.result.split(',');
      if (!base64) {
        reject(new Error('Failed to extract base64 data'));
        return;
      }

      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

async function uploadImage(file: File) {
  uploading.value = true;
  emitStatus('uploading', true);

  try {
    const base64Data = await readFileAsBase64(file);

    const result = await uploadImageToBlossom({
      base64Data,
      fileType: file.type,
      ...(props.uploadId ? { uploadId: props.uploadId } : {}),
    });

    emitUploadedOnce(result.url);
    $q.notify({
      type: 'positive',
      message: t('profile.uploadSuccess'),
    });
  } catch (error: unknown) {
    console.error('Error uploading image:', error);
    let errorMessage = t('profile.uploadError');
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'object' && error !== null) {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === 'string') {
        errorMessage = message;
      }
    }

    $q.notify({
      type: 'negative',
      message: errorMessage,
    });
  } finally {
    uploading.value = false;
    emitStatus('uploading', false);
    if (fileInput.value) {
      fileInput.value.value = '';
    }
  }
}

onMounted(async () => {
  // Check for completed uploads from a previous session
  const status = await storageService.get<StorageUploadStatus>(BLOSSOM_UPLOAD_STATUS);
  if (status) {
    if (status.url) {
      emitUploadedOnce(status.url);
      void storageService.remove(BLOSSOM_UPLOAD_STATUS);
    } else if (status.error) {
      $q.notify({
        type: 'negative',
        message: status.error,
      });
      void storageService.remove(BLOSSOM_UPLOAD_STATUS);
    }
  }

  // Storage listener kept as optional recovery for edge cases
  // (e.g. upload completed while popup was closed).
  // The direct response from uploadImageToBlossom is the authoritative success path.
  const storageListener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ) => {
    if (areaName === 'local' && BLOSSOM_UPLOAD_STATUS in changes) {
      const statusChange = changes[BLOSSOM_UPLOAD_STATUS];
      if (statusChange) {
        const status = statusChange.newValue;
        if (isUploadStatus(status)) {
          if (status.url) {
            emitUploadedOnce(status.url);
          } else if (status.error && !uploading.value) {
            // Only show storage-sourced errors when we're not actively uploading
            // (the direct call handles error notification for active uploads)
            $q.notify({
              type: 'negative',
              message: status.error,
            });
          }
          // Clear status after processing
          void storageService.remove(BLOSSOM_UPLOAD_STATUS);
        }
      }
    }
  };

  storageService.onChanged(storageListener);

  onUnmounted(() => {
    storageService.removeOnChanged(storageListener);
  });
});

function triggerUpload() {
  fileInput.value?.click();
}
</script>

<template>
  <div class="inline-block" style="pointer-events: auto">
    <q-btn
      :loading="uploading"
      class="diogel-btn-ghost"
      icon="cloud_upload"
      round
      type="button"
      @click.capture.stop.prevent="triggerUpload"
      @mousedown.stop
      @mouseup.stop
      @touchstart.stop
      @touchend.stop
    >
      <q-tooltip v-if="label">{{ label }}</q-tooltip>
    </q-btn>
    <teleport to="body">
      <input
        ref="fileInput"
        accept=".jpg, .jpeg, .png, .gif, .webp"
        style="display: none"
        type="file"
        @change="handleFileChange"
      />
    </teleport>
  </div>
</template>