import { onMounted, onUnmounted, ref, type Ref } from 'vue';

import { sendBexMessage } from '@/services/bridge-client';
import { LogLevel, logService } from '@/services/log-service';

export interface UseActiveTabResult {
  /** Origin of the active tab in this window, or an empty string when there is none. */
  activeOrigin: Ref<string>;
}



/**
 * Track the active tab's origin for panel context.
 *
 * This is context only. A request always carries its own origin, and the panel must display that
 * rather than this value, because a request may come from a background tab or another window
 * (ADR D2, specification S8).
 *
 * The origin cannot be read from the tab here. `chrome.tabs.query` redacts `url` unless the
 * extension holds `tabs` or a host permission, and NFR-18 forbids adding either on the Chromium
 * build, so this used to resolve to an empty string in every real build and the panel showed
 * nothing. The tab id is available, and the background knows which origin is loaded in which tab
 * from the content script's port, so the id is resolved there instead.
 */
export function useActiveTab(): UseActiveTabResult {
  const activeOrigin = ref('');

  const refresh = async (): Promise<void> => {
    try {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id;
      if (tabId === undefined) {
        activeOrigin.value = '';
        return;
      }

      activeOrigin.value = (await sendBexMessage('pages.originForTab', { tabId })) ?? '';
    } catch (error: unknown) {
      logService.log(LogLevel.DEBUG, '[Sidebar] Failed to read active tab', {
        error: error instanceof Error ? error.message : String(error),
      });
      activeOrigin.value = '';
    }
  };

  const onActivated = (): void => {
    void refresh();
  };

  // `changeInfo.url` is redacted for the same reason `tab.url` is, so status is the only usable
  // signal that the tab loaded something new.
  const onUpdated = (_tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo): void => {
    if (changeInfo.status === undefined) return;
    void refresh();
  };

  onMounted(() => {
    void refresh();
    chrome.tabs?.onActivated?.addListener(onActivated);
    chrome.tabs?.onUpdated?.addListener(onUpdated);
  });

  onUnmounted(() => {
    chrome.tabs?.onActivated?.removeListener(onActivated);
    chrome.tabs?.onUpdated?.removeListener(onUpdated);
  });

  return { activeOrigin };
}
