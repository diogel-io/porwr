/**
 * Vault backup download port (#314).
 *
 * Saves a vault backup through the browser's `downloads` API with `saveAs: true`, so Chromium and
 * Firefox both show a Save As dialog and the user chooses where the file goes. This is the only
 * module that touches `chrome.downloads`; pages reach it through `useVaultManagement`.
 *
 * It runs on the extension page, not in the background: the page can make a blob URL for the file,
 * an MV3 service worker cannot, and Firefox refuses `data:` URLs for downloads.
 *
 * The two browsers report a cancelled dialog differently. Firefox rejects `download()`; Chromium may
 * reject it too, or start the download and then interrupt it with `USER_CANCELED`. Both come back as
 * `cancelled`, which is an outcome, not an error.
 */

export type VaultBackupSaveResult =
  | { readonly status: 'saved'; readonly path: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly error: string };

/** The members of `chrome.downloads` this port uses, so tests can supply their own. */
export interface DownloadsApi {
  download(options: {
    url: string;
    filename: string;
    saveAs: boolean;
    conflictAction: 'uniquify';
  }): Promise<number>;
  search(query: { id: number }): Promise<ReadonlyArray<{ filename?: string }>>;
  onChanged: {
    addListener(listener: (delta: DownloadChange) => void): void;
    removeListener(listener: (delta: DownloadChange) => void): void;
  };
}

export interface DownloadChange {
  readonly id: number;
  readonly state?: { readonly current?: string };
  readonly error?: { readonly current?: string };
}

/** The outcome a download's change describes, or `undefined` while it is still in progress. */
type Ending = 'complete' | 'cancelled' | { failed: string };

const endingOf = (change: DownloadChange): Ending | undefined => {
  if (change.state?.current === 'complete') return 'complete';
  if (change.state?.current !== 'interrupted') return undefined;
  const reason = change.error?.current;
  return reason === 'USER_CANCELED' ? 'cancelled' : { failed: reason || 'Download interrupted' };
};

const isCancellation = (error: unknown): boolean =>
  /cancel/i.test(error instanceof Error ? error.message : String(error));

const getDownloadsApi = (): DownloadsApi | undefined => {
  if (typeof chrome === 'undefined') return undefined;
  const candidate = (chrome as { downloads?: DownloadsApi }).downloads;
  return typeof candidate?.download === 'function' ? candidate : undefined;
};

/** Saves `contents` as `fileName`, letting the user choose where, and says what happened. */
export async function saveVaultBackup(
  fileName: string,
  contents: string,
  api: DownloadsApi | undefined = getDownloadsApi(),
): Promise<VaultBackupSaveResult> {
  if (!api) {
    return { status: 'failed', error: 'This browser does not let Porwr save files' };
  }

  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));

  // Listening before the download starts, so an ending that arrives before `download()` resolves is
  // not missed.
  const endings = new Map<number, Ending>();
  let settle: ((ending: Ending) => void) | undefined;
  let downloadId: number | undefined;
  const onChanged = (change: DownloadChange) => {
    const ending = endingOf(change);
    if (ending === undefined) return;
    if (change.id === downloadId && settle) settle(ending);
    else endings.set(change.id, ending);
  };
  api.onChanged.addListener(onChanged);

  try {
    try {
      downloadId = await api.download({
        url,
        filename: fileName,
        saveAs: true,
        conflictAction: 'uniquify',
      });
    } catch (error: unknown) {
      if (isCancellation(error)) return { status: 'cancelled' };
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (typeof downloadId !== 'number') return { status: 'cancelled' };

    const id = downloadId;
    const ending =
      endings.get(id) ??
      (await new Promise<Ending>((resolve) => {
        settle = resolve;
      }));

    if (ending === 'cancelled') return { status: 'cancelled' };
    if (ending !== 'complete') return { status: 'failed', error: ending.failed };

    const [item] = await api.search({ id }).catch(() => []);
    return { status: 'saved', path: item?.filename ?? fileName };
  } finally {
    api.onChanged.removeListener(onChanged);
    URL.revokeObjectURL(url);
  }
}
