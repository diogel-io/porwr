<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { uploadImageToBlossom } from '@/services/blossom-upload-service';
import { storageService } from '@/services/storage-service';
import { isBlossomUploadErrorCode } from '@/services/blossom-server';
import type { AccountSummary } from '@/types/accounts';

defineOptions({ name: 'ImageUploader' });

const props = defineProps<{
  storedKey: AccountSummary;
  label?: string;
  /**
   * Shown on the button itself. Without it the button is a bare round icon, which is fine beside a
   * titled card and not fine laid over an image, where nothing else says what it changes.
   */
  text?: string;
  uploadId?: string;
}>();

/**
 * Each uploaded URL comes with the pubkey of the account it was uploaded for, so it is published to
 * that account even if the page has since switched to another (#400).
 */
const emit = defineEmits<{
  (e: 'uploaded', url: string, pubkey: string): void;
  (e: 'uploading', status: boolean): void;
  (e: 'avatar-uploaded', url: string, pubkey: string): void;
  (e: 'avatar-uploading', status: boolean): void;
  (e: 'banner-uploaded', url: string, pubkey: string): void;
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

/**
 * The message for an upload status error. The status holds a code, never the server's text
 * (porwr#370); anything else, such as text stored before that change, gets the general message.
 */
function uploadStatusMessage(error: string): string {
  return isBlossomUploadErrorCode(error)
    ? t(`profile.uploadErrors.${error}`)
    : t('profile.uploadError');
}

/**
 * The id the background names an upload's stored status after. It holds the account as well as the
 * image, so a finished upload recovered from storage can only ever be applied to its own account
 * (#400). The background treats it as an opaque name.
 */
function scopedUploadId(pubkey: string): string {
  return `${props.uploadId ?? 'image'}:${pubkey}`;
}

function statusKey(pubkey: string): string {
  return `blossom:upload_status:${scopedUploadId(pubkey)}`;
}
/** Where statuses went before they named an account. Nothing may apply them, so they are dropped. */
const LEGACY_UPLOAD_STATUS = props.uploadId
  ? `blossom:upload_status:${props.uploadId}`
  : 'blossom:upload_status';

function emitUploading(status: boolean) {
  emit('uploading', status);
  if (props.uploadId === 'avatar') emit('avatar-uploading', status);
  else if (props.uploadId === 'banner') emit('banner-uploading', status);
}

function emitUploadedOnce(url: string, pubkey: string) {
  // Blossom URLs name the file's hash, so the same image uploaded for two accounts has one URL; each
  // account's upload is still its own (#400).
  const uploaded = `${pubkey}:${url}`;
  if (lastUploadedUrl.value === uploaded) return;
  lastUploadedUrl.value = uploaded;
  emit('uploaded', url, pubkey);
  if (props.uploadId === 'avatar') emit('avatar-uploaded', url, pubkey);
  else if (props.uploadId === 'banner') emit('banner-uploaded', url, pubkey);
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
  // Fixed when the upload starts: the page may switch account before it finishes (#400).
  const pubkey = props.storedKey.id;
  // A new upload is never a duplicate of an earlier one, even of the same image.
  lastUploadedUrl.value = null;
  uploading.value = true;
  emitUploading(true);

  try {
    const base64Data = await readFileAsBase64(file);

    const result = await uploadImageToBlossom({
      base64Data,
      fileType: file.type,
      uploadId: scopedUploadId(pubkey),
    });

    emitUploadedOnce(result.url, pubkey);
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
    emitUploading(false);
    if (fileInput.value) {
      fileInput.value.value = '';
    }
  }
}

// Storage listener kept as optional recovery for edge cases
// (e.g. upload completed while popup was closed).
// The direct response from uploadImageToBlossom is the authoritative success path.
// Only the shown account's status is read; another account's waits until that account is shown.
const storageListener = (
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string,
) => {
  const pubkey = props.storedKey.id;
  const key = statusKey(pubkey);
  if (areaName === 'local' && key in changes) {
    const statusChange = changes[key];
    if (statusChange) {
      const status = statusChange.newValue;
      if (isUploadStatus(status)) {
        if (status.url) {
          emitUploadedOnce(status.url, pubkey);
        } else if (status.error && !uploading.value) {
          // Only show storage-sourced errors when we're not actively uploading
          // (the direct call handles error notification for active uploads)
          $q.notify({
            type: 'negative',
            message: uploadStatusMessage(status.error),
          });
        }
        // Clear status after processing
        void storageService.remove(key);
      }
    }
  }
};

// Registered during setup, not inside the async onMounted: a hook registered after an `await` has no
// component to belong to, so Vue drops it and the listener outlives the page (#252).
let unmounted = false;
onBeforeUnmount(() => {
  unmounted = true;
  storageService.removeOnChanged(storageListener);
});

/** Applies a finished upload stored for `pubkey`, if that account is still the one shown. */
async function applyStoredStatus(pubkey: string) {
  const key = statusKey(pubkey);
  const status = await storageService.get<StorageUploadStatus>(key);
  if (unmounted || pubkey !== props.storedKey.id || !status) return;

  if (status.url) {
    emitUploadedOnce(status.url, pubkey);
    void storageService.remove(key);
  } else if (status.error) {
    $q.notify({
      type: 'negative',
      message: uploadStatusMessage(status.error),
    });
    void storageService.remove(key);
  }
}

onMounted(async () => {
  // A status from before statuses named an account could belong to any account: drop it unread.
  void storageService.remove(LEGACY_UPLOAD_STATUS);

  // Check for completed uploads from a previous session
  await applyStoredStatus(props.storedKey.id);
  // Left before the read came back: listening now would leave a listener nothing removes.
  if (unmounted) return;

  storageService.onChanged(storageListener);
});

// The page reuses this uploader when the account changes, so look for the new account's status too.
watch(
  () => props.storedKey.id,
  (pubkey) => {
    void applyStoredStatus(pubkey);
  },
);

function triggerUpload() {
  fileInput.value?.click();
}
</script>

<template>
  <div class="inline-block" style="pointer-events: auto">
    <q-btn
      :label="text"
      :loading="uploading"
      :no-caps="Boolean(text)"
      :round="!text"
      :rounded="Boolean(text)"
      class="diogel-btn-ghost"
      icon="cloud_upload"
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
