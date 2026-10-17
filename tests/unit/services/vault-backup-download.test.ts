import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type DownloadChange,
  type DownloadsApi,
  saveVaultBackup,
} from '@/services/vault-backup-download';

/** Saving a vault backup through the downloads API's Save As dialog (#314). */

const FILE_NAME = 'diogel-vault-backup-2026-10-17.json';
const BLOB_URL = 'blob:chrome-extension://porwr/backup';

/** A fake `chrome.downloads`. `answer` decides what `download()` does once it is called. */
function fakeDownloads(answer: (emit: (change: DownloadChange) => void) => Promise<number>) {
  const listeners = new Set<(change: DownloadChange) => void>();
  const emit = (change: DownloadChange) => listeners.forEach((listener) => listener(change));
  const api = {
    download: vi.fn(() => answer(emit)),
    search: vi.fn(async ({ id }: { id: number }) => [{ filename: `/home/me/Backups/${id}.json` }]),
    onChanged: {
      addListener: vi.fn((listener: (change: DownloadChange) => void) => listeners.add(listener)),
      removeListener: vi.fn((listener: (change: DownloadChange) => void) =>
        listeners.delete(listener),
      ),
    },
  } satisfies DownloadsApi;
  return { api, listeners };
}

const later = (fn: () => void) => setTimeout(fn, 0);

describe('saveVaultBackup (#314)', () => {
  const createObjectURL = vi.fn(() => BLOB_URL);
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for a Save As dialog with the backup name, and reports where the file was saved', async () => {
    const { api, listeners } = fakeDownloads(async (send) => {
      later(() => {
        send({ id: 7, state: { current: 'in_progress' } });
        send({ id: 99, state: { current: 'complete' } });
        send({ id: 7, state: { current: 'complete' } });
      });
      return 7;
    });

    const result = await saveVaultBackup(FILE_NAME, '{"version":1}', api);

    expect(api.download).toHaveBeenCalledWith({
      url: BLOB_URL,
      filename: FILE_NAME,
      saveAs: true,
      conflictAction: 'uniquify',
    });
    expect(result).toEqual({ status: 'saved', path: '/home/me/Backups/7.json' });
    expect(listeners.size).toBe(0);
    expect(revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
  });

  it('puts the backup in the blob it downloads', async () => {
    const { api } = fakeDownloads(async (send) => {
      later(() => send({ id: 1, state: { current: 'complete' } }));
      return 1;
    });

    await saveVaultBackup(FILE_NAME, '{"version":1}', api);

    const [blob] = createObjectURL.mock.calls[0] as unknown as [Blob];
    expect(blob.type).toBe('application/json');
    expect(blob.size).toBe('{"version":1}'.length);
  });

  it('does not miss a download that completes before download() resolves', async () => {
    const { api } = fakeDownloads(async (send) => {
      send({ id: 3, state: { current: 'complete' } });
      return 3;
    });

    await expect(saveVaultBackup(FILE_NAME, '{}', api)).resolves.toEqual({
      status: 'saved',
      path: '/home/me/Backups/3.json',
    });
  });

  it('still reports a save when the saved path cannot be looked up', async () => {
    const { api } = fakeDownloads(async (send) => {
      later(() => send({ id: 4, state: { current: 'complete' } }));
      return 4;
    });
    api.search.mockRejectedValue(new Error('no access'));

    await expect(saveVaultBackup(FILE_NAME, '{}', api)).resolves.toEqual({
      status: 'saved',
      path: FILE_NAME,
    });
  });

  it.each([
    ['Chromium', 'Download canceled'],
    ['Firefox', 'Download canceled by the user'],
  ])('treats %s rejecting a cancelled dialog as not saved', async (_browser, message) => {
    const { api, listeners } = fakeDownloads(() => Promise.reject(new Error(message)));

    await expect(saveVaultBackup(FILE_NAME, '{}', api)).resolves.toEqual({ status: 'cancelled' });
    expect(listeners.size).toBe(0);
    expect(revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
  });

  it('treats a download interrupted by the user as not saved', async () => {
    const { api } = fakeDownloads(async (send) => {
      later(() =>
        send({ id: 5, state: { current: 'interrupted' }, error: { current: 'USER_CANCELED' } }),
      );
      return 5;
    });

    await expect(saveVaultBackup(FILE_NAME, '{}', api)).resolves.toEqual({ status: 'cancelled' });
  });

  it('reports any other interruption as a failure, with its reason', async () => {
    const { api } = fakeDownloads(async (send) => {
      later(() =>
        send({ id: 6, state: { current: 'interrupted' }, error: { current: 'FILE_NO_SPACE' } }),
      );
      return 6;
    });

    await expect(saveVaultBackup(FILE_NAME, '{}', api)).resolves.toEqual({
      status: 'failed',
      error: 'FILE_NO_SPACE',
    });
    expect(api.search).not.toHaveBeenCalled();
  });

  it('reports a refused download as a failure', async () => {
    const { api, listeners } = fakeDownloads(() => Promise.reject(new Error('Invalid filename')));

    await expect(saveVaultBackup(FILE_NAME, '{}', api)).resolves.toEqual({
      status: 'failed',
      error: 'Invalid filename',
    });
    expect(listeners.size).toBe(0);
    expect(revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
  });

  it('fails plainly, without making a blob, when the browser offers no downloads API', async () => {
    await expect(saveVaultBackup(FILE_NAME, '{}', undefined)).resolves.toEqual({
      status: 'failed',
      error: 'This browser does not let Porwr save files',
    });
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
