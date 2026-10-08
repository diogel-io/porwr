import { sendBexMessage } from './vault-service';
import useSettingsStore from '@/stores/settings-store';

export interface BlossomUploadInput {
  base64Data: string;
  fileType: string;
  uploadId?: string;
}

export interface BlossomUploadResult {
  url: string;
}

interface BlossomUploadSuccessResponse {
  success: true;
  url: string;
}

interface BlossomUploadErrorResponse {
  success: false;
  error: string;
}

function isSuccessfulUploadResponse(value: unknown): value is BlossomUploadSuccessResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).success === true &&
    typeof (value as Record<string, unknown>).url === 'string' &&
    (value as Record<string, unknown>).url !== ''
  );
}

function isFailedUploadResponse(value: unknown): value is BlossomUploadErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).success === false &&
    typeof (value as Record<string, unknown>).error === 'string'
  );
}

function getUploadErrorMessage(value: unknown): string | null {
  if (isFailedUploadResponse(value)) {
    return value.error;
  }

  if (typeof value === 'object' && value !== null) {
    const error = (value as Record<string, unknown>).error;
    if (typeof error === 'string' && error.length > 0) {
      return error;
    }
  }

  return null;
}

export async function uploadImageToBlossom(
  input: BlossomUploadInput,
): Promise<BlossomUploadResult> {
  const settingsStore = useSettingsStore();
  await settingsStore.getSettings();

  const response = await sendBexMessage('blossom.upload', {
    base64Data: input.base64Data,
    fileType: input.fileType,
    blossomServer: settingsStore.blossomServer,
    ...(input.uploadId ? { uploadId: input.uploadId } : {}),
  });

  if (isSuccessfulUploadResponse(response)) {
    return { url: response.url };
  }

  const message = getUploadErrorMessage(response) || 'Image upload failed';
  throw new Error(message);
}