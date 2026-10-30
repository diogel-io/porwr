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

/**
 * The `server` tags of a kind 10063, in their order and without duplicates.
 *
 * Valid servers are normalised. Ones Porwr would not upload to, such as an http:// server another
 * client added, are kept as published, so saving a new primary does not drop them.
 */
export function parseServerList(event: Event): string[] {
  if (event.kind !== BLOSSOM_SERVER_LIST_KIND || !Array.isArray(event.tags)) return [];
  const servers: string[] = [];
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== 'server' || typeof tag[1] !== 'string') continue;
    const raw = tag[1].trim();
    const server = normalizeBlossomServer(raw).url ?? raw;
    if (server && !servers.includes(server)) {
      servers.push(server);
    }
  }
  return servers;
}

/** The first server of `servers` Porwr may upload to, if any. */
function firstUsableServer(servers: readonly string[]): string | undefined {
  return servers.find((server) => normalizeBlossomServer(server).valid);
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
  const usable = firstUsableServer(servers);
  if (usable) primaryServers.set(pubkey, usable);
  return { status: 'found', servers };
}

/**
 * Signs `tags` as `pubkey`'s kind 10063 in the background and publishes it.
 *
 * It goes where `RelayEditor` sends a kind 10002: the fallback relays and the account's NIP-65
 * write relays. Resolves once every relay has answered and at least one accepted it, and remembers
 * the new primary server.
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
    // Every relay is given its chance before the pool closes; one acceptance is enough.
    const results = await Promise.allSettled(pool.publish(targets, event));
    if (!results.some((result) => result.status === 'fulfilled')) {
      throw new Error('No relay accepted the Blossom server list');
    }
  } finally {
    pool.close(targets);
  }

  const primary = tags[0]?.[1];
  if (primary) primaryServers.set(pubkey, primary);
}

/**
 * Where `pubkey`'s images are uploaded: the first https:// server of its kind 10063, or the
 * Blossom setting when it has none or the list cannot be read.
 */
export async function resolveUploadServer(pubkey: string): Promise<string> {
  const known = primaryServers.get(pubkey);
  if (known) return known;

  const lookup = await fetchServerList(pubkey);
  const usable = lookup.status === 'found' ? firstUsableServer(lookup.servers) : undefined;
  if (usable) return usable;

  const settingsStore = useSettingsStore();
  await settingsStore.getSettings();
  return settingsStore.blossomServer;
}

/** Test seam: forgets every remembered primary server. */
export function clearRememberedServers(): void {
  primaryServers.clear();
}
