import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { storageService, NOSTR_ACTIVE, BLOSSOM_UPLOAD_STATUS } from '@/services/storage-service';
import { LogLevel, logService } from '@/services/log-service';
import type { VaultData, StoredKey } from '@/types/bridge';
import type { HandlerResult } from '../types/background';
import { handleVaultGetData, handleVaultIsUnlocked } from './vault-handler';

export async function handleBlossomUpload(
  payload: {
    base64Data: string;
    fileType: string;
    blossomServer: string;
    uploadId?: string;
  },
  _origin: string = '',
): Promise<HandlerResult<string>> {
  void _origin;
  const { base64Data, fileType, blossomServer, uploadId } = payload;

  const uploadStatusKey = uploadId
    ? `blossom:upload_status:${uploadId}`
    : BLOSSOM_UPLOAD_STATUS;

  if (!base64Data || !blossomServer) {
    return {
      success: false,
      error: 'Missing base64Data or blossomServer for upload',
    };
  }

  await storageService.set(uploadStatusKey, {
    uploading: true,
    error: null,
    url: null,
  });

  try {
    const storedKey = await getActiveStoredKey();
    if (!storedKey) {
      throw new Error('No active account found');
    }

    const sk = hexToBytes(storedKey.account.privkey);
    const pk = getPublicKey(sk);

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const hash = sha256(bytes);
    const hashHex = Array.from(hash)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    const normalizedServer = blossomServer.replace(/\/$/, '');
    const uploadOptions = [
      { url: `${normalizedServer}/upload`, method: 'PUT' },
      { url: `${normalizedServer}/upload`, method: 'POST' },
      { url: `${normalizedServer}/`, method: 'PUT' },
      { url: `${normalizedServer}/`, method: 'POST' },
      { url: `${normalizedServer}/${hashHex}`, method: 'PUT' },
      { url: blossomServer, method: 'PUT' },
    ];

    let uploadResultUrl = '';
    let lastError: Error | null = null;

    for (const option of uploadOptions) {
      try {
        logService.log(LogLevel.DEBUG, `[BEX] Attempting ${option.method} upload`, {
          url: option.url,
        });

        const eventTemplate = {
          kind: 24242,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['t', 'upload'],
            ['x', hashHex],
            ['u', option.url],
            ['method', option.method],
            ['size', bytes.length.toString()],
          ],
          content: 'Upload file',
          pubkey: pk,
        };

        const signedEvent = finalizeEvent(eventTemplate, sk);
        const signedEventJson = JSON.stringify(signedEvent);
        const authHeader = `Nostr ${btoa(signedEventJson)}`;

        const response = await fetch(option.url, {
          method: option.method,
          headers: {
            Authorization: authHeader,
            ...(fileType ? { 'Content-Type': fileType } : {}),
          },
          body: bytes,
        });

        if (response.ok) {
          logService.log(LogLevel.DEBUG, '[BEX] Upload successful', { url: option.url });

          if (response.status !== 204) {
            try {
              const responseText = await response.text();
              try {
                const json = JSON.parse(responseText) as { url?: string };
                if (json.url) {
                  uploadResultUrl = String(json.url);
                }
              } catch {
                if (responseText.startsWith('http')) {
                  uploadResultUrl = responseText.trim();
                }
              }
            } catch {
              // Ignore body read errors
            }
          }

          if (!uploadResultUrl && option.url === `${normalizedServer}/${hashHex}`) {
            uploadResultUrl = option.url;
          }

          if (uploadResultUrl) {
            break;
          }
        } else {
          const errorText = await response.text().catch(() => '');
          lastError = new Error(
            `HTTP Error ${response.status}: ${response.statusText}. ${errorText.substring(0, 100)}`,
          );

          if ([413, 401, 403].includes(response.status)) {
            break;
          }
        }
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    if (!uploadResultUrl) {
      throw lastError || new Error('Upload failed after multiple attempts');
    }

    await storageService.set(uploadStatusKey, {
      uploading: false,
      error: null,
      url: uploadResultUrl,
    });
    return { success: true, data: uploadResultUrl };
  } catch (error: unknown) {
    const finalError = error instanceof Error ? error : new Error(String(error));
    logService.log(LogLevel.ERROR, '[BEX] Error in blossom.upload', {
      error: finalError.message,
    });

    const activeAlias = await storageService.get<string>(NOSTR_ACTIVE);
    void logService.logException(
      `Error in blossom.upload: ${finalError.message}`,
      activeAlias || 'unknown',
      'background',
    );

    await storageService.set(uploadStatusKey, {
      uploading: false,
      error: finalError.message,
      url: null,
    });

    return { success: false, error: finalError.message };
  }
}

async function getActiveStoredKey(): Promise<StoredKey | null> {
  const isUnlockedResult = await handleVaultIsUnlocked({}, '');
  if (!isUnlockedResult.success || !isUnlockedResult.data) {
    return null;
  }

  const activeAlias = await storageService.get<string>(NOSTR_ACTIVE);

  if (!activeAlias) {
    const vaultDataRes = (await handleVaultGetData({}, '')) as HandlerResult<{ vaultData?: VaultData }>;
    if (vaultDataRes.success && vaultDataRes.data.vaultData) {
      const vaultData = vaultDataRes.data.vaultData;
      const accounts = vaultData.accounts || [];
      if (accounts.length > 0) {
        const fallbackAccount = accounts[0];
        if (fallbackAccount) {
          await storageService.set(NOSTR_ACTIVE, fallbackAccount.alias);
          return fallbackAccount;
        }
      }
    }
    return null;
  }

  const vaultRes = (await handleVaultGetData({}, '')) as HandlerResult<{ vaultData?: VaultData }>;
  if (vaultRes.success && vaultRes.data.vaultData) {
    return vaultRes.data.vaultData.accounts?.find((account) => account.alias === activeAlias) || null;
  }

  return null;
}
