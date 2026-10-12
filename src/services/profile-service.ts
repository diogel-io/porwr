import { SimplePool } from 'nostr-tools';
import { signAsAccount } from './account-signing-client';
import type { NostrProfile } from '../types';
import useSettingsStore from '../stores/settings-store';
import { PROFILE_UPDATED_KEY, storageService } from './storage-service';

const pool = new SimplePool();

/**
 * Tell every surface showing this profile that it has changed.
 *
 * Called after the event is published rather than before: a surface that re-reads on the strength
 * of a publish that then failed would show something that is not on any relay.
 *
 * Every kind 0 the dashboard publishes goes through `saveProfile`, so this is the one place it is
 * sent. The avatar and banner path published its own event and had to signal for itself until #200.
 */
const notifyProfileChanged = async (pubkey: string): Promise<void> => {
  await storageService.set(PROFILE_UPDATED_KEY, { pubkey, at: Date.now() });
};

export const profileService = {
  async fetchProfile(pubkey: string): Promise<NostrProfile | null> {
    if (!pubkey) return null;

    const settingsStore = useSettingsStore();
    const relays = await settingsStore.getFallbackRelays();
    // `pool.get` over no relays never settles: it resolves when every relay has closed, and with none
    // there is nothing to close. Each relay is otherwise bounded by the pool's own connection and EOSE
    // timeouts, so this is the one way a profile fetch could leave a page spinning (#200).
    if (relays.length === 0) return null;

    try {
      const event = await pool.get(relays, {
        authors: [pubkey],
        kinds: [0],
      });

      if (event && event.content) {
        return JSON.parse(event.content) as NostrProfile;
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
    return null;
  },

  /** Publishes `profile` as account `pk`, signed in the background, which holds the key (#240). */
  async saveProfile(pk: string, profile: NostrProfile): Promise<void> {
    // Fetch latest profile to avoid overwriting other fields (like picture/banner)
    const latestProfile = await this.fetchProfile(pk);

    const updatedProfile = {
      ...latestProfile,
      ...profile,
      // Ensure we don't accidentally overwrite with undefined if they were present in latestProfile
      picture: profile.picture !== undefined ? profile.picture : latestProfile?.picture,
      banner: profile.banner !== undefined ? profile.banner : latestProfile?.banner,
    };

    const signedEvent = await signAsAccount(pk, {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify(updatedProfile),
    });

    const settingsStore = useSettingsStore();
    const relays = await settingsStore.getFallbackRelays();

    await Promise.any(pool.publish(relays, signedEvent));
    await notifyProfileChanged(pk);
  },
};
