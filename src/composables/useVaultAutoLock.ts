import { onBeforeUnmount, onMounted } from 'vue';
import useVaultStore from '@/stores/vault-store';

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'click',
  'focus',
];

export function useVaultAutoLock() {
  const vaultStore = useVaultStore();

  let lastActivitySentAt = 0;
  const ACTIVITY_THROTTLE_MS = 10_000;

  const markActivity = () => {
    if (!vaultStore.isUnlocked) return;

    const now = Date.now();
    if (now - lastActivitySentAt < ACTIVITY_THROTTLE_MS) return;

    lastActivitySentAt = now;

    // Notify background script
    // @ts-expect-error bex is not typed on window
    const bridge = window.bridge || window.$q?.bex;
    if (bridge) {
      void bridge.send({ event: 'activity.mark', to: 'background' });
    } else if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      // Fallback for direct messaging
      void chrome.runtime.sendMessage({ type: 'activity.mark' });
    }
  };

  onMounted(() => {
    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });

    // Initial activity mark
    markActivity();
  });

  onBeforeUnmount(() => {
    ACTIVITY_EVENTS.forEach((eventName) => {
      window.removeEventListener(eventName, markActivity);
    });
  });

  // We no longer manage the timer or locking here.
  // The background script handles the single source of truth for inactivity.

  return {
    markActivity,
  };
}
