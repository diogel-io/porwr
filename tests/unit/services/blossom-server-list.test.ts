import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Event } from 'nostr-tools';

const mocks = vi.hoisted(() => ({
  fetchAccountReplaceableEvent: vi.fn(),
  fetchAccountRelayListEvent: vi.fn(),
  signAsAccount: vi.fn(),
  publish: vi.fn(),
  close: vi.fn(),
  getFallbackRelays: vi.fn(),
  getSettings: vi.fn(),
  settings: { blossomServer: 'https://vault.example/' },
}));

vi.mock('@/services/relay-discovery', async () => {
  const actual = await vi.importActual<typeof import('@/services/relay-discovery')>(
    '@/services/relay-discovery',
  );
  return {
    extractWritePreferredRelayUrls: actual.extractWritePreferredRelayUrls,
    fetchAccountReplaceableEvent: mocks.fetchAccountReplaceableEvent,
    fetchAccountRelayListEvent: mocks.fetchAccountRelayListEvent,
  };
});

vi.mock('@/services/account-signing-client', () => ({
  signAsAccount: mocks.signAsAccount,
}));

vi.mock('nostr-tools', async () => {
  const actual = await vi.importActual<typeof import('nostr-tools')>('nostr-tools');
  return {
    ...actual,
    SimplePool: vi.fn(function SimplePool() {
      return { publish: mocks.publish, close: mocks.close };
    }),
  };
});

vi.mock('@/stores/settings-store', () => ({
  default: () => ({
    get blossomServer() {
      return mocks.settings.blossomServer;
    },
    getFallbackRelays: mocks.getFallbackRelays,
    getSettings: mocks.getSettings,
  }),
}));

import {
  buildServerListTags,
  clearRememberedServers,
  fetchServerList,
  parseServerList,
  publishServerList,
  resolveUploadServer,
} from '@/services/blossom-server-list';

const PUBKEY = 'a'.repeat(64);

const serverList = (tags: string[][], kind = 10063): Event =>
  ({ kind, tags, content: '', created_at: 1, pubkey: PUBKEY, id: 'x', sig: 'y' }) as Event;

beforeEach(() => {
  vi.clearAllMocks();
  clearRememberedServers();
  mocks.settings.blossomServer = 'https://vault.example/';
  mocks.getFallbackRelays.mockResolvedValue(['wss://fallback.example']);
  mocks.fetchAccountRelayListEvent.mockResolvedValue(null);
  mocks.signAsAccount.mockImplementation((_pubkey: string, template: object) =>
    Promise.resolve({ ...template, pubkey: PUBKEY, id: 'id', sig: 'sig' }),
  );
  mocks.publish.mockImplementation((relays: string[]) => relays.map(() => Promise.resolve('ok')));
});

describe('parseServerList (porwr#417)', () => {
  it('reads the server tags in order, normalised and without duplicates', () => {
    const event = serverList([
      ['server', 'https://primary.example/'],
      ['r', 'wss://ignored.example'],
      ['server', 'https://mirror.example'],
      ['server', 'https://primary.example'],
      ['server', 'http://plaintext.example'],
      ['server'],
    ]);

    expect(parseServerList(event)).toEqual(['https://primary.example', 'https://mirror.example']);
  });

  it('reads nothing from another kind', () => {
    expect(parseServerList(serverList([['server', 'https://a.example']], 10002))).toEqual([]);
  });
});

describe('buildServerListTags (porwr#417)', () => {
  it('puts the new primary first and keeps the rest in order without repeating it', () => {
    expect(
      buildServerListTags('https://new.example', [
        'https://old.example',
        'https://new.example',
        'https://mirror.example',
      ]),
    ).toEqual([
      ['server', 'https://new.example'],
      ['server', 'https://old.example'],
      ['server', 'https://mirror.example'],
    ]);
  });

  it('lists only the primary when there was no list', () => {
    expect(buildServerListTags('https://new.example', [])).toEqual([
      ['server', 'https://new.example'],
    ]);
  });
});

describe('fetchServerList (porwr#417)', () => {
  it('asks the fallback relays for the account’s kind 10063', async () => {
    mocks.fetchAccountReplaceableEvent.mockResolvedValue({
      status: 'found',
      event: serverList([['server', 'https://primary.example']]),
    });

    await expect(fetchServerList(PUBKEY)).resolves.toEqual({
      status: 'found',
      servers: ['https://primary.example'],
    });
    expect(mocks.fetchAccountReplaceableEvent).toHaveBeenCalledWith(PUBKEY, 10063);
  });

  it('treats a list with no usable server as none', async () => {
    mocks.fetchAccountReplaceableEvent.mockResolvedValue({
      status: 'found',
      event: serverList([['server', 'http://plaintext.example']]),
    });

    await expect(fetchServerList(PUBKEY)).resolves.toEqual({ status: 'not-found' });
  });

  it.each(['not-found', 'unreachable'])('passes on %s', async (status) => {
    mocks.fetchAccountReplaceableEvent.mockResolvedValue({ status });

    await expect(fetchServerList(PUBKEY)).resolves.toEqual({ status });
  });
});

describe('publishServerList (porwr#417)', () => {
  const tags = [
    ['server', 'https://new.example'],
    ['server', 'https://mirror.example'],
  ];

  it('signs an empty-content kind 10063 as the account, in the background', async () => {
    await publishServerList(PUBKEY, tags);

    expect(mocks.signAsAccount).toHaveBeenCalledWith(
      PUBKEY,
      expect.objectContaining({ kind: 10063, content: '', tags }),
    );
  });

  it('publishes to the fallback relays and the account’s write relays', async () => {
    mocks.fetchAccountRelayListEvent.mockResolvedValue({
      kind: 10002,
      tags: [
        ['r', 'wss://write.example', 'write'],
        ['r', 'wss://read.example', 'read'],
        ['r', 'wss://fallback.example'],
      ],
    });

    await publishServerList(PUBKEY, tags);

    expect(mocks.publish).toHaveBeenCalledWith(
      ['wss://fallback.example', 'wss://write.example'],
      expect.objectContaining({ kind: 10063 }),
    );
  });

  it('fails when no relay accepts the list', async () => {
    mocks.publish.mockImplementation((relays: string[]) =>
      relays.map(() => Promise.reject(new Error('blocked'))),
    );

    await expect(publishServerList(PUBKEY, tags)).rejects.toThrow();
  });

  it('fails without signing when there is no relay to publish to', async () => {
    mocks.getFallbackRelays.mockResolvedValue([]);

    await expect(publishServerList(PUBKEY, tags)).rejects.toThrow();
    expect(mocks.signAsAccount).not.toHaveBeenCalled();
  });
});

describe('resolveUploadServer (porwr#417)', () => {
  it('uses the primary just saved, without asking the relays', async () => {
    await publishServerList(PUBKEY, [['server', 'https://saved.example']]);

    await expect(resolveUploadServer(PUBKEY)).resolves.toBe('https://saved.example');
    expect(mocks.fetchAccountReplaceableEvent).not.toHaveBeenCalled();
  });

  it('reads the account’s list once, then remembers its primary', async () => {
    mocks.fetchAccountReplaceableEvent.mockResolvedValue({
      status: 'found',
      event: serverList([['server', 'https://primary.example']]),
    });

    await expect(resolveUploadServer(PUBKEY)).resolves.toBe('https://primary.example');
    await expect(resolveUploadServer(PUBKEY)).resolves.toBe('https://primary.example');
    expect(mocks.fetchAccountReplaceableEvent).toHaveBeenCalledTimes(1);
  });

  it.each(['not-found', 'unreachable'])(
    'falls back to the vault setting when the list is %s',
    async (status) => {
      mocks.fetchAccountReplaceableEvent.mockResolvedValue({ status });

      await expect(resolveUploadServer(PUBKEY)).resolves.toBe('https://vault.example/');
    },
  );

  it('keeps each account’s server apart', async () => {
    await publishServerList(PUBKEY, [['server', 'https://alice.example']]);
    mocks.fetchAccountReplaceableEvent.mockResolvedValue({ status: 'not-found' });

    await expect(resolveUploadServer('b'.repeat(64))).resolves.toBe('https://vault.example/');
  });
});
