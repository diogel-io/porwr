/**
 * An account's Blossom User Server List: kind 10063, BUD-03 and NIP-B7 (porwr#417).
 *
 * The list is a replaceable event whose `server` tags name, in order of preference, the Blossom
 * servers the account uploads to. Porwr edits only the first, the primary, and keeps the rest as
 * they were published, so mirrors chosen in another client survive a save here.
 */
import { SimplePool, type Event } from 'nostr-tools';

import { signAsAccount } from './account-signing-client';
import { normalizeBlossomServer } from './blossom-server';
import {
  extractWritePreferredRelayUrls,
  fetchAccountRelayListEvent,
  fetchAccountReplaceableEvent,
} from './relay-discovery';
import useSettingsStore from '@/stores/settings-store';

export const BLOSSOM_SERVER_LIST_KIND = 10063;

/** What a lookup of an account's server list found; `servers` is in the list's order. */
export type BlossomServerListLookup =
  { status: 'found'; servers: string[] } | { status: 'not-found' } | { status: 'unreachable' };

/**
 * The primary server of each account whose list this page has read or saved, so a Profile upload
 * does not wait on the relays every time.
 *
 * Held in memory rather than `chrome.storage.local`: content scripts can write that, and a value
 * there would choose where the account's images are sent.
 */
const primaryServers = new Map<string, string>();

/** The valid `server` tags of a kind 10063, normalised, without duplicates, in their order. */
export function parseServerList(event: Event): string[] {
  if (event.kind !== BLOSSOM_SERVER_LIST_KIND || !Array.isArray(event.tags)) return [];
  const servers: string[] = [];
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== 'server' || typeof tag[1] !== 'string') continue;
    const result = normalizeBlossomServer(tag[1]);
    if (result.valid && result.url && !servers.includes(result.url)) {
      servers.push(result.url);
    }
  }
  return servers;
}

/** `primary` first, then the other servers of `existing` in their order. */
export function buildServerListTags(primary: string, existing: readonly string[]): string[][] {
  return [primary, ...existing.filter((server) => server !== primary)].map((server) => [
    'server',
    server,
  ]);
}

/** Reads `pubkey`'s kind 10063 from the fallback relays, and remembers its primary server. */
export async function fetchServerList(pubkey: string): Promise<BlossomServerListLookup> {
  const lookup = await fetchAccountReplaceableEvent(pubkey, BLOSSOM_SERVER_LIST_KIND);
  if (lookup.status !== 'found') return lookup;

  const servers = parseServerList(lookup.event);
  if (servers.length === 0) return { status: 'not-found' };
  primaryServers.set(pubkey, servers[0]!);
  return { status: 'found', servers };
}

/**
 * Signs `tags` as `pubkey`'s kind 10063 in the background and publishes it.
 *
 * It goes where `RelayEditor` sends a kind 10002: the fallback relays and the account's NIP-65
 * write relays. Resolves once one relay accepts it, and remembers the new primary server.
 */
export async function publishServerList(pubkey: string, tags: string[][]): Promise<void> {
  const settingsStore = useSettingsStore();
  const fallback = await settingsStore.getFallbackRelays();
  const relayList = await fetchAccountRelayListEvent(pubkey);
  const targets = [
    ...new Set([...fallback, ...(relayList ? extractWritePreferredRelayUrls(relayList) : [])]),
  ];
  if (targets.length === 0) {
    throw new Error('No relays to publish the Blossom server list to');
  }

  const event = await signAsAccount(pubkey, {
    kind: BLOSSOM_SERVER_LIST_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  });

  const pool = new SimplePool();
  try {
    await Promise.any(pool.publish(targets, event));
  } finally {
    pool.close(targets);
  }

  const primary = tags[0]?.[1];
  if (primary) primaryServers.set(pubkey, primary);
}

/**
 * Where `pubkey`'s images are uploaded: the primary server of its kind 10063, or the vault's
 * Blossom setting when it has none or it cannot be read.
 */
export async function resolveUploadServer(pubkey: string): Promise<string> {
  const known = primaryServers.get(pubkey);
  if (known) return known;

  const lookup = await fetchServerList(pubkey);
  if (lookup.status === 'found') return lookup.servers[0]!;

  const settingsStore = useSettingsStore();
  await settingsStore.getSettings();
  return settingsStore.blossomServer;
}

/** Test seam: forgets every remembered primary server. */
export function clearRememberedServers(): void {
  primaryServers.clear();
}
