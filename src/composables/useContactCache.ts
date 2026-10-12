import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import { toValue } from 'vue';
import { observeContactCache } from '@/services/contact-cache';
import { requestContactRefresh } from '@/services/contact-list-service';
import type { CachedContactList, ContactProfile, Nip02Contact } from '@/types/contact-list';

/**
 * - `idle`: no account to show contacts for.
 * - `loading`: relays have never been asked for this account, so there is nothing to show yet.
 *   Never shown as "no contacts".
 * - `ready`: the cache holds this account's list, which may be empty.
 */
export type ContactCacheStatus = 'idle' | 'loading' | 'ready';

/**
 * An account's cached contacts and profiles, kept current (#257).
 *
 * Shows what the cache holds at once and has the background revalidate it; anything the
 * background writes arrives here without a reload. Switching account drops the previous account's
 * contacts before the next account's arrive, so they can never be shown under the wrong account.
 */
export function useContactCache(accountPubkey: MaybeRefOrGetter<string | undefined>) {
  const list = shallowRef<CachedContactList | undefined>();
  const profiles = shallowRef<Record<string, ContactProfile>>({});
  const status = ref<ContactCacheStatus>('idle');
  const error = ref('');

  let stopObserving: (() => void) | undefined;

  const contacts = computed<Nip02Contact[]>(() => list.value?.contacts ?? []);

  async function refresh(force = false): Promise<void> {
    error.value = '';
    try {
      await requestContactRefresh(force ? { force } : {});
    } catch (refreshError: unknown) {
      error.value = refreshError instanceof Error ? refreshError.message : String(refreshError);
    }
  }

  watch(
    () => toValue(accountPubkey),
    (pubkey) => {
      stopObserving?.();
      stopObserving = undefined;
      list.value = undefined;
      profiles.value = {};
      error.value = '';
      status.value = pubkey ? 'loading' : 'idle';
      if (!pubkey) return;

      stopObserving = observeContactCache(
        pubkey,
        (snapshot) => {
          if (toValue(accountPubkey) !== pubkey) return;
          list.value = snapshot.list;
          profiles.value = snapshot.profiles;
          status.value = snapshot.list ? 'ready' : 'loading';
        },
        (observeError) => {
          error.value = observeError instanceof Error ? observeError.message : String(observeError);
        },
      );
      // Stale-while-revalidate: whatever the cache holds is shown, and relays are always asked again
      // when a page opens. The background's freshness window is only for its own triggers.
      void refresh(true);
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    stopObserving?.();
  });

  return { list, contacts, profiles, status, error, refresh };
}
