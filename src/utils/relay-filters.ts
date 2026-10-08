import type { RelayCatalogEntry } from '@/types/relay';

export function filterRelays(
  relays: RelayCatalogEntry[],
  searchText: string,
  searchOnly: boolean,
): RelayCatalogEntry[] {
  const normalizedSearch = searchText.toLowerCase().trim();

  return relays.filter((relay) => {
    // 1. Filter by searchCapable (NIP-50)
    if (searchOnly) {
      const supportedNips = relay.metadata?.supported_nips || [];
      if (!supportedNips.includes(50)) {
        return false;
      }
    }

    // 2. Filter by text (name, hostname, URL)
    if (normalizedSearch) {
      const name = (relay.metadata?.name || '').toLowerCase();
      const hostname = (relay.hostname || '').toLowerCase();
      const url = (relay.url || '').toLowerCase();

      if (
        !name.includes(normalizedSearch) &&
        !hostname.includes(normalizedSearch) &&
        !url.includes(normalizedSearch)
      ) {
        return false;
      }
    }

    return true;
  });
}
