import { db } from '@/services/database';

export const PROFILE_SEARCH_RELAYS_SETTING_KEY = 'nostr:profile-search-relays' as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export async function getStoredProfileSearchRelays(): Promise<string[] | undefined> {
  const setting = await db.appSettings.get(PROFILE_SEARCH_RELAYS_SETTING_KEY);
  return isStringArray(setting?.value) ? setting.value : undefined;
}

export async function setStoredProfileSearchRelays(relays: string[]): Promise<void> {
  await db.appSettings.put({
    key: PROFILE_SEARCH_RELAYS_SETTING_KEY,
    value: relays,
    updatedAt: new Date().toISOString(),
  });
}
