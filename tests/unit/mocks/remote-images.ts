import { createPinia, setActivePinia } from 'pinia';

import useSettingsStore from '@/stores/settings-store';

/**
 * Gives a component test a settings store that has already been read, so `RemoteImage` renders at
 * once instead of reading storage (diogel-io/workspace#148). Remote images load unless `load` is
 * false.
 */
export function useLoadedSettings(load = true): void {
  setActivePinia(createPinia());
  useSettingsStore().$patch({ settingsLoaded: true, loadRemoteImages: load });
}
