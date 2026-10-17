import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import { fetchAccountRelayList, fetchAccountRelayListEvent } from '@/services/relay-discovery';

/**
 * A relay list lookup tells "no kind 10002" apart from "could not reach the relays" (#285).
 *
 * These run the real nostr-tools pool against fake relay sockets, so they also pin the close reason
 * nostr-tools gives a relay that answered: if an upgrade changes it, the not-found case fails here.
 */

// The `nostr-tools` entry point captures `WebSocket` when it loads; the `nostr-tools/pool` build
// reads it per pool, which lets these tests hand it the fake sockets below.
vi.mock('nostr-tools', async () => ({
  ...(await vi.importActual<typeof import('nostr-tools')>('nostr-tools')),
  SimplePool: (await vi.importActual<typeof import('nostr-tools/pool')>('nostr-tools/pool'))
    .SimplePool,
}));

const { settingsStoreMock } = vi.hoisted(() => {
  const mock = {
    fallbackRelays: [] as string[],
    getFallbackRelays: async () => mock.fallbackRelays,
  };
  return { settingsStoreMock: mock };
});

vi.mock('@/stores/settings-store', () => ({ default: () => settingsStoreMock }));

type RelayBehaviour =
  | { kind: 'answers'; events: unknown[] }
  | { kind: 'refuses' }
  | { kind: 'silent' };

const relays = new Map<string, RelayBehaviour>();

/** A relay socket that answers a REQ with its events and EOSE, refuses to connect, or never opens. */
class FakeRelaySocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeRelaySocket.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((ev: { message?: string }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    const behaviour = relays.get(url) ?? { kind: 'refuses' };
    if (behaviour.kind === 'silent') return;
    setTimeout(() => {
      if (behaviour.kind === 'refuses') {
        this.onerror?.();
        return;
      }
      this.readyState = FakeRelaySocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(message: string): void {
    const [type, subId] = JSON.parse(message) as [string, string];
    const behaviour = relays.get(this.url);
    if (type !== 'REQ' || behaviour?.kind !== 'answers') return;
    setTimeout(() => {
      for (const event of behaviour.events) {
        this.onmessage?.({ data: JSON.stringify(['EVENT', subId, event]) });
      }
      this.onmessage?.({ data: JSON.stringify(['EOSE', subId]) });
    }, 0);
  }

  close(): void {
    this.readyState = FakeRelaySocket.CLOSED;
  }
}

const secretKey = generateSecretKey();
const pubkey = getPublicKey(secretKey);

function relayList(createdAt: number, relayUrl: string) {
  return finalizeEvent(
    { kind: 10002, created_at: createdAt, tags: [['r', relayUrl]], content: '' },
    secretKey,
  );
}

describe('looking up an account relay list (#285)', () => {
  beforeEach(() => {
    relays.clear();
    useWebSocketImplementation(FakeRelaySocket);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('finds the newest relay list any relay has', async () => {
    const older = relayList(1_700_000_000, 'wss://older.example');
    const newer = relayList(1_700_000_100, 'wss://newer.example');
    relays.set('wss://a.example/', { kind: 'answers', events: [older] });
    relays.set('wss://b.example/', { kind: 'answers', events: [newer] });
    settingsStoreMock.fallbackRelays = ['wss://a.example/', 'wss://b.example/'];

    const lookup = await fetchAccountRelayList(pubkey);

    expect(lookup.status).toBe('found');
    expect(lookup.status === 'found' && lookup.event.id).toBe(newer.id);
  });

  it('says not-found when a relay answers without one', async () => {
    relays.set('wss://a.example/', { kind: 'answers', events: [] });
    settingsStoreMock.fallbackRelays = ['wss://a.example/'];

    await expect(fetchAccountRelayList(pubkey)).resolves.toEqual({ status: 'not-found' });
  });

  it('says not-found when one relay answers without one and another cannot be reached', async () => {
    relays.set('wss://a.example/', { kind: 'answers', events: [] });
    relays.set('wss://down.example/', { kind: 'refuses' });
    settingsStoreMock.fallbackRelays = ['wss://a.example/', 'wss://down.example/'];

    await expect(fetchAccountRelayList(pubkey)).resolves.toEqual({ status: 'not-found' });
  });

  it('says unreachable when no relay can be reached', async () => {
    relays.set('wss://down.example/', { kind: 'refuses' });
    relays.set('wss://also-down.example/', { kind: 'refuses' });
    settingsStoreMock.fallbackRelays = ['wss://down.example/', 'wss://also-down.example/'];

    await expect(fetchAccountRelayList(pubkey)).resolves.toEqual({ status: 'unreachable' });
  });

  it('says unreachable when a relay never finishes connecting', async () => {
    vi.useFakeTimers();
    relays.set('wss://silent.example/', { kind: 'silent' });
    settingsStoreMock.fallbackRelays = ['wss://silent.example/'];

    const lookup = fetchAccountRelayList(pubkey);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(lookup).resolves.toEqual({ status: 'unreachable' });
  });

  it('says unreachable when there are no fallback relays to ask', async () => {
    settingsStoreMock.fallbackRelays = [];

    await expect(fetchAccountRelayList(pubkey)).resolves.toEqual({ status: 'unreachable' });
  });

  it('keeps fetchAccountRelayListEvent returning the event, or null otherwise', async () => {
    const event = relayList(1_700_000_000, 'wss://relay.example');
    relays.set('wss://a.example/', { kind: 'answers', events: [event] });
    settingsStoreMock.fallbackRelays = ['wss://a.example/'];
    expect((await fetchAccountRelayListEvent(pubkey))?.id).toBe(event.id);

    relays.set('wss://a.example/', { kind: 'refuses' });
    await expect(fetchAccountRelayListEvent(pubkey)).resolves.toBeNull();
  });
});
