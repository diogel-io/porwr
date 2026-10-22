import { computed, reactive, ref, type ComputedRef } from 'vue';

import useSettingsStore from '@/stores/settings-store';

/**
 * Whether a remote image may load on Porwr's own pages (threat model T32, diogel-io/workspace#148).
 *
 * Each profile picture, banner or relay icon is fetched from whatever host its profile or relay
 * names, and that fetch tells the host which identity the user is looking at. With "Load remote
 * images" off, an image loads only once the user asks for it, or for every image on the page.
 *
 * State is module-scoped so every image on a page, and the notice that offers to load them all,
 * share one answer. What the user loaded is held in memory only, never stored: remembering it
 * would keep a record of the identities they viewed. The router clears it on each new page.
 *
 * Until the settings have been read nothing remote loads, whatever the setting turns out to be:
 * an image fetched in that moment could not be taken back.
 */

const loadedUrls = reactive(new Set<string>());
const pageLoaded = ref(false);
/** The images on screen now that are waiting for the user, by registration id. */
const hiddenImages = reactive(new Map<number, string>());
let nextId = 0;
let settingsRead: Promise<void> | null = null;

/** Local images (`data:` and `blob:` URLs) are already on the device and are never held back. */
export function isRemoteImageUrl(url: string): boolean {
  return !/^(data|blob):/i.test(url.trim());
}

/** Forgets what the user loaded. The router calls it when the page changes. */
export function resetRemoteImageReveals(): void {
  loadedUrls.clear();
  pageLoaded.value = false;
}

export interface UseRemoteImagesResult {
  /** The settings have been read, so the answer below is final. */
  ready: ComputedRef<boolean>;
  /** Remote images are held back until the user asks for them. */
  blocking: ComputedRef<boolean>;
  /** How many images on screen are waiting for the user. */
  hiddenCount: ComputedRef<number>;
  /** Every image on this page has been let through. */
  pageLoaded: ComputedRef<boolean>;
  canLoad: (url: string) => boolean;
  loadOne: (url: string) => void;
  loadAll: () => void;
  /** Tracks one image placeholder; returns an id for `setHidden` and `release`. */
  register: () => number;
  setHidden: (id: number, url: string | null) => void;
  release: (id: number) => void;
}

export function useRemoteImages(): UseRemoteImagesResult {
  const settingsStore = useSettingsStore();

  if (!settingsStore.settingsLoaded && !settingsRead) {
    // One read for every image on the page. A failed read leaves nothing loading, and the next
    // image to mount tries again.
    settingsRead = settingsStore
      .getSettings()
      .catch(() => undefined)
      .finally(() => {
        settingsRead = null;
      });
  }

  const ready = computed(() => settingsStore.settingsLoaded);
  const blocking = computed(() => !ready.value || !settingsStore.loadRemoteImages);

  const canLoad = (url: string): boolean => {
    if (!isRemoteImageUrl(url)) return true;
    if (!ready.value) return false;
    return settingsStore.loadRemoteImages || pageLoaded.value || loadedUrls.has(url);
  };

  return {
    ready,
    blocking,
    hiddenCount: computed(() => hiddenImages.size),
    pageLoaded: computed(() => pageLoaded.value),
    canLoad,
    loadOne: (url: string) => {
      loadedUrls.add(url);
    },
    loadAll: () => {
      pageLoaded.value = true;
    },
    register: () => ++nextId,
    setHidden: (id: number, url: string | null) => {
      if (url === null) hiddenImages.delete(id);
      else hiddenImages.set(id, url);
    },
    release: (id: number) => {
      hiddenImages.delete(id);
    },
  };
}
