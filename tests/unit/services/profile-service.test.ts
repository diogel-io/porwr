import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import { storageService } from '@/services/storage-service';

const { poolGetMock, poolPublishMock, fallbackRelays } = vi.hoisted(() => ({
  poolGetMock: vi.fn(),
  poolPublishMock: vi.fn(),
  fallbackRelays: ['wss://relay.damus.io'] as string[],
}));

vi.mock('@/services/storage-service', () => ({
  PROFILE_UPDATED_KEY: 'profile:updated',
  storageService: { set: vi.fn(() => Promise.resolve()) },
}));

vi.mock('@/stores/settings-store', () => ({
  default: () => ({
    getFallbackRelays: vi.fn(async () => fallbackRelays),
  }),
}));

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>();
  return {
    ...actual,
    SimplePool: class {
      get = poolGetMock;
      publish = poolPublishMock;
    },
  };
});

describe('profileService.fetchProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null without querying relays when the pubkey is empty', async () => {
    const { profileService } = await import('@/services/profile-service');

    await expect(profileService.fetchProfile('')).resolves.toBeNull();
    expect(poolGetMock).not.toHaveBeenCalled();
  });

  it('parses and returns the profile from a kind-0 metadata event', async () => {
    poolGetMock.mockResolvedValue({ content: JSON.stringify({ name: 'Alice' }) });

    const { profileService } = await import('@/services/profile-service');
    const result = await profileService.fetchProfile('pubkey-a');

    expect(poolGetMock).toHaveBeenCalledWith(fallbackRelays, { authors: ['pubkey-a'], kinds: [0] });
    expect(result).toEqual({ name: 'Alice' });
  });

  it('returns null when no metadata event is found', async () => {
    poolGetMock.mockResolvedValue(null);

    const { profileService } = await import('@/services/profile-service');
    await expect(profileService.fetchProfile('pubkey-a')).resolves.toBeNull();
  });

  it('returns null when the relay query rejects', async () => {
    poolGetMock.mockRejectedValue(new Error('relay unreachable'));

    const { profileService } = await import('@/services/profile-service');
    await expect(profileService.fetchProfile('pubkey-a')).resolves.toBeNull();
  });
});

describe('profileService.saveProfile', () => {
  const privkey = 'aa'.repeat(32);
  const pubkey = getPublicKey(hexToBytes(privkey));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges the new profile fields over the latest fetched profile and publishes it', async () => {
    poolGetMock.mockResolvedValue({ content: JSON.stringify({ name: 'Old Name', picture: 'old.png' }) });
    poolPublishMock.mockReturnValue([Promise.resolve('relay-ack')]);

    const { profileService } = await import('@/services/profile-service');
    await profileService.saveProfile(privkey, { name: 'New Name' });

    expect(poolGetMock).toHaveBeenCalledWith(fallbackRelays, { authors: [pubkey], kinds: [0] });
    expect(poolPublishMock).toHaveBeenCalledTimes(1);

    const [relays, signedEvent] = poolPublishMock.mock.calls[0] as [string[], { content: string; pubkey: string; kind: number }];
    expect(relays).toEqual(fallbackRelays);
    expect(signedEvent.pubkey).toBe(pubkey);
    expect(signedEvent.kind).toBe(0);
    const publishedContent = JSON.parse(signedEvent.content) as { name: string; picture: string };
    expect(publishedContent).toEqual({ name: 'New Name', picture: 'old.png' });
  });

  it('rejects when every relay publish fails', async () => {
    poolGetMock.mockResolvedValue(null);
    poolPublishMock.mockReturnValue([Promise.reject(new Error('relay rejected'))]);

    const { profileService } = await import('@/services/profile-service');
    await expect(profileService.saveProfile(privkey, { name: 'New Name' })).rejects.toThrow();
  });
});

/**
 * The cross-surface signal (#201).
 *
 * The panel and the dashboard editor are separate page contexts. Before this, saving a profile in
 * a tab left an open panel showing the old one until it was reopened, and the dashboard's own
 * preview was the only thing that ever reflected an edit.
 */
describe('the profile-changed signal', () => {
  const privkey = 'aa'.repeat(32);
  const pubkey = getPublicKey(hexToBytes(privkey));

  beforeEach(() => {
    vi.clearAllMocks();
    poolGetMock.mockResolvedValue(null);
  });

  it('records the change after a successful publish, not before', async () => {
    const order: string[] = [];
    vi.mocked(storageService.set).mockImplementation(() => {
      order.push('signal');
      return Promise.resolve();
    });
    poolPublishMock.mockImplementation(() => {
      order.push('publish');
      return [Promise.resolve('relay-ack')];
    });

    const { profileService } = await import('@/services/profile-service');
    await profileService.saveProfile(privkey, { name: 'alice' });

    // Signalling first would tell every surface to re-read on the strength of a publish that had
    // not happened yet, and might still fail.
    expect(order).toEqual(['publish', 'signal']);
  });

  it('names the account whose profile changed', async () => {
    poolPublishMock.mockReturnValue([Promise.resolve('relay-ack')]);

    const { profileService } = await import('@/services/profile-service');
    await profileService.saveProfile(privkey, { name: 'alice' });

    expect(storageService.set).toHaveBeenCalledWith(
      'profile:updated',
      expect.objectContaining({ pubkey }),
    );
  });

  it('does not signal when every relay publish fails', async () => {
    poolPublishMock.mockReturnValue([Promise.reject(new Error('relay rejected'))]);

    const { profileService } = await import('@/services/profile-service');
    await expect(profileService.saveProfile(privkey, { name: 'alice' })).rejects.toThrow();

    // A surface that re-read here would show what is on the relays, which is not what was saved.
    expect(storageService.set).not.toHaveBeenCalled();
  });
});
