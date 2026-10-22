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
 * "Load images on this page" lets through the images waiting at that moment, not whatever the page
 * shows next: a new search result names a host the user has not chosen to contact.
 *
 * Until the setting has been read nothing remote loads, whatever it turns out to be: an image
 * fetched in that moment could not be taken back.
 */

const loadedUrls = reactive(new Set<string>());
/** The images on screen now that are waiting for the user, by registration id. */
const hiddenImages = reactive(new Map<number, { url: string; interactive: boolean }>());
/** Mounted page notices, newest last. Only the newest shows, so an open dialog's notice wins. */
const notices = ref<number[]>([]);
let nextId = 0;

/** Local images (`data:` and `blob:` URLs) are already on the device and are never held back. */
export function isRemoteImageUrl(url: string): boolean {
  return !/^(data|blob):/i.test(url.trim());
}

/** Forgets what the user loaded. The router calls it when the page changes. */
export function resetRemoteImageReveals(): void {
  loadedUrls.clear();
}

export interface UseRemoteImagesResult {
  /** The setting has been read, so the answer below is final. */
  ready: ComputedRef<boolean>;
  /** Remote images are held back until the user asks for them. */
  blocking: ComputedRef<boolean>;
  /**
   * How many images in the page's content are waiting for the user. Images inside a control, such
   * as the header's account avatars, are left out, so they alone never raise the notice.
   */
  hiddenCount: ComputedRef<number>;
  canLoad: (url: string) => boolean;
  loadOne: (url: string) => void;
  /** Loads the images waiting now. Anything that appears on the page later waits again. */
  loadAll: () => void;
  /** Tracks one image placeholder; returns an id for `setHidden` and `release`. */
  register: () => number;
  setHidden: (id: number, url: string | null, interactive?: boolean) => void;
  release: (id: number) => void;
  /** Tracks one page notice; returns an id for `isTopNotice` and `releaseNotice`. */
  registerNotice: () => number;
  isTopNotice: (id: number) => boolean;
  releaseNotice: (id: number) => void;
}

export function useRemoteImages(): UseRemoteImagesResult {
  const settingsStore = useSettingsStore();

  if (!settingsStore.loadRemoteImagesRead) {
    // Only this setting, not every setting: one read, shared by every image on the page. It never
    // fails; a read that cannot be made holds images back.
    void settingsStore.refreshLoadRemoteImages();
  }

  const ready = computed(() => settingsStore.loadRemoteImagesRead);
  const blocking = computed(() => !ready.value || !settingsStore.loadRemoteImages);

  const canLoad = (url: string): boolean => {
    if (!isRemoteImageUrl(url)) return true;
    if (!ready.value) return false;
    return settingsStore.loadRemoteImages || loadedUrls.has(url);
  };

  return {
    ready,
    blocking,
    hiddenCount: computed(
      () => [...hiddenImages.values()].filter((image) => image.interactive).length,
    ),
    canLoad,
    loadOne: (url: string) => {
      loadedUrls.add(url);
    },
    loadAll: () => {
      for (const { url } of hiddenImages.values()) loadedUrls.add(url);
    },
    register: () => ++nextId,
    setHidden: (id: number, url: string | null, interactive = true) => {
      if (url === null) hiddenImages.delete(id);
      else hiddenImages.set(id, { url, interactive });
    },
    release: (id: number) => {
      hiddenImages.delete(id);
    },
    registerNotice: () => {
      const id = ++nextId;
      notices.value = [...notices.value, id];
      return id;
    },
    isTopNotice: (id: number) => notices.value[notices.value.length - 1] === id,
    releaseNotice: (id: number) => {
      notices.value = notices.value.filter((notice) => notice !== id);
    },
  };
}
