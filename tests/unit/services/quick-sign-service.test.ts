import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get, getActive } from '@/services/dexie-storage';
import { LogLevel, logService } from '@/services/log-service';
import { isVaultUnlocked, sendBexMessage } from '@/services/vault-service';
import {
  buildQuickSignPreviewEvent,
  getQuickSignAvailability,
  listQuickSignAccountRelayUrls,
  listQuickSignAccounts,
  QUICK_SIGN_SUPPORTED_KINDS,
  quickSignEvent,
  validateQuickSignContent,
  validateQuickSignInput,
} from '@/services/quick-sign-service';

vi.mock('@/services/dexie-storage', () => ({
  get: vi.fn(),
  getActive: vi.fn(),
}));

vi.mock('@/services/vault-service', () => ({
  isVaultUnlocked: vi.fn(),
  sendBexMessage: vi.fn(),
}));

const { poolGetMock, poolCloseMock, poolPublishMock, verifyEventMock } = vi.hoisted(() => ({
  poolGetMock: vi.fn(),
  poolCloseMock: vi.fn(),
  poolPublishMock: vi.fn(),
  verifyEventMock: vi.fn(),
}));

const { settingsStoreMock } = vi.hoisted(() => {
  const mock = {
    fallbackRelays: ['wss://seed-relay.example'],
    getSettings: vi.fn(async () => undefined),
    getFallbackRelays: vi.fn(async () => mock.fallbackRelays),
  };
  return { settingsStoreMock: mock };
});

vi.mock('@/stores/settings-store', () => ({
  default: () => settingsStoreMock,
}));

vi.mock('nostr-tools', async () => {
  const actual = await vi.importActual<typeof import('nostr-tools')>('nostr-tools');
  return {
    ...actual,
    verifyEvent: verifyEventMock,
    SimplePool: vi.fn().mockImplementation(function MockSimplePool(this: unknown) {
      return {
        get: poolGetMock,
        close: poolCloseMock,
        publish: poolPublishMock,
      };
    }),
  };
});

describe('quick-sign-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyEventMock.mockReturnValue(true);
    vi.mocked(isVaultUnlocked).mockResolvedValue(true);
    vi.mocked(sendBexMessage).mockResolvedValue({
      success: true,
      event: {
        id: 'signed-event-id',
        pubkey: 'f'.repeat(64),
        created_at: 1735689600,
        kind: 1,
        tags: [],
        content: 'hello nostr',
        sig: 'f'.repeat(128),
      },
    } as unknown as Awaited<ReturnType<typeof sendBexMessage>>);
    vi.mocked(getActive).mockResolvedValue('alpha');
    vi.mocked(get).mockResolvedValue({
      alpha: {
        id: 'f'.repeat(64),
        alias: 'alpha',
        account: { privkey: 'e'.repeat(64) },
        createdAt: '2026-01-01',
      },
    });
    settingsStoreMock.fallbackRelays = ['wss://seed-relay.example'];
    poolPublishMock.mockImplementation(() => [Promise.resolve('ok')]);
  });

  it('returns success publish status when all selected relays publish successfully', async () => {
    const logSpy = vi.spyOn(logService, 'log');

    const result = await quickSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: 1735689600, pubkey: 'f'.repeat(64) },
      true,
      ['wss://relay-a.example', 'wss://relay-b.example'],
      'alpha',
    );

    expect(result.success).toBe(true);
    expect(result.publishStatus).toBe('success');
    expect(result.relayResults).toEqual([
      { relayUrl: 'wss://relay-a.example', success: true },
      { relayUrl: 'wss://relay-b.example', success: true },
    ]);
    expect(logSpy).toHaveBeenCalledWith(
      LogLevel.INFO,
      '[QuickSign] Event publish completed',
      expect.objectContaining({
        operation: 'quick-sign',
        account: 'alpha',
        kind: 1,
        relayCount: 2,
        result: 'success',
      }),
    );
  });

  it('returns partial-failure publish status when some relays fail', async () => {
    poolPublishMock
      .mockImplementationOnce(() => [Promise.resolve('ok')])
      .mockImplementationOnce(() => [Promise.reject(new Error('permission denied'))]);

    const result = await quickSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: 1735689600, pubkey: 'f'.repeat(64) },
      true,
      ['wss://relay-a.example', 'wss://relay-b.example'],
      'alpha',
    );

    expect(result.success).toBe(true);
    expect(result.publishStatus).toBe('partial-failure');
    expect(result.relayResults).toEqual([
      { relayUrl: 'wss://relay-a.example', success: true },
      {
        relayUrl: 'wss://relay-b.example',
        success: false,
        error: 'permission denied',
      },
    ]);
  });

  it('preserves relay permission errors on total publish failure', async () => {
    poolPublishMock
      .mockImplementationOnce(() => [Promise.reject(new Error('permission denied'))])
      .mockImplementationOnce(() => [Promise.reject(new Error('relay unavailable'))]);

    const result = await quickSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: 1735689600, pubkey: 'f'.repeat(64) },
      true,
      ['wss://relay-a.example', 'wss://relay-b.example'],
      'alpha',
    );

    expect(result.success).toBe(false);
    expect(result.publishStatus).toBe('failed');
    expect(result.relayResults).toEqual([
      { relayUrl: 'wss://relay-a.example', success: false, error: 'permission denied' },
      { relayUrl: 'wss://relay-b.example', success: false, error: 'relay unavailable' },
    ]);
  });

  it('returns failed publish status when all relays fail', async () => {
    poolPublishMock.mockImplementation(() => [Promise.reject(new Error('relay unavailable'))]);

    const result = await quickSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: 1735689600, pubkey: 'f'.repeat(64) },
      true,
      ['wss://relay-a.example', 'wss://relay-b.example'],
      'alpha',
    );

    expect(result.success).toBe(false);
    expect(result.publishStatus).toBe('failed');
    expect(result.code).toBeDefined();
    expect(result.relayResults).toHaveLength(2);
    expect(result.relayResults.every((relayResult) => relayResult.success === false)).toBe(true);
  });

  it('keeps signing failures distinct from publishing failures', async () => {
    vi.mocked(get).mockResolvedValueOnce({}); // No accounts found

    const result = await quickSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: 1735689600, pubkey: 'f'.repeat(64) },
      true,
      ['wss://relay-a.example'],
      'alpha',
    );

    expect(result.success).toBe(false);
    expect(result.publishStatus).toBe('not-attempted');
    expect(result.relayResults).toEqual([]);
    expect(poolPublishMock).not.toHaveBeenCalled();
  });

  it('logs safe quick-sign metadata without event content or secrets', async () => {
    const logSpy = vi.spyOn(logService, 'log');

    await quickSignEvent(
      { kind: 1, content: 'sensitive body', tags: [], created_at: 1735689600, pubkey: 'f'.repeat(64) },
      true,
      ['wss://relay-a.example'],
      'alpha',
    );

    const publishLog = logSpy.mock.calls.find(([, message]) => message === '[QuickSign] Event publish completed');
    expect(publishLog).toBeTruthy();
    const context = publishLog?.[2] as Record<string, unknown>;
    expect(context).toMatchObject({
      operation: 'quick-sign',
      account: 'alpha',
      kind: 1,
      relayCount: 1,
    });
    expect(context).not.toHaveProperty('content');
    expect(context).not.toHaveProperty('sig');
    expect(context).not.toHaveProperty('privkey');
  });

  it('returns locked state when vault is locked', async () => {
    vi.mocked(isVaultUnlocked).mockResolvedValue(false);

    await expect(getQuickSignAvailability(false)).resolves.toEqual({ state: 'locked' });
  });

  it('returns no-account state when no active account exists', async () => {
    vi.mocked(getActive).mockResolvedValue(undefined);

    await expect(getQuickSignAvailability(false)).resolves.toEqual({ state: 'no-account' });
  });

  it('returns no-relay state when publish requested and no relay selection exists', async () => {
    await expect(getQuickSignAvailability(true, [])).resolves.toEqual({ state: 'no-relay' });
  });

  it('returns ready state for valid account and one relay context', async () => {
    await expect(getQuickSignAvailability(true, ['wss://relay.example'])).resolves.toEqual({ state: 'ready' });
  });

  it('returns ready state for valid account and multiple relay context', async () => {
    await expect(getQuickSignAvailability(true, ['wss://relay-a.example', 'wss://relay-b.example'])).resolves.toEqual({ state: 'ready' });
  });

  it('validates missing account, malformed JSON and empty relay selection', () => {
    const result = validateQuickSignInput({
      accountAlias: ' ',
      kind: 1,
      content: 'hello nostr',
      tags: [],
    }, {
      relayUrls: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Signing account is required.');
    expect(result.errors).toContain('Select at least one relay to publish.');
  });

  it('declares supported kinds as 1 and 30023 only', () => {
    expect(QUICK_SIGN_SUPPORTED_KINDS).toEqual([1, 30023]);
  });

  it('accepts valid kind 1 input', () => {
    const result = validateQuickSignInput({
      accountAlias: 'alpha',
      kind: 1,
      content: 'hello nostr',
      tags: [{ type: 't', value: 'tag-value' }],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid kind 30023 input', () => {
    const result = validateQuickSignInput({
      accountAlias: 'alpha',
      kind: 30023,
      content: 'Long form content body',
      tags: [{ type: 'a', value: '30023:pubkey:slug' }],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects unsupported kind', () => {
    const result = validateQuickSignInput({
      accountAlias: 'alpha',
      kind: 7 as unknown as 1,
      content: 'hello nostr',
      tags: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Event kind is not supported by quick-sign.');
  });

  it('accepts markdown for kind 1', () => {
    const result = validateQuickSignInput({
      accountAlias: 'alpha',
      kind: 1,
      content: '# Heading\n- item\n[text](https://example.com)\n`inline`',
      tags: [],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts kind 1 normal multiline plain text with comparison operators', () => {
    const result = validateQuickSignContent(1, 'first line\nsecond line\n1 < 2 and 3 > 2');

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts markdown for kind 30023', () => {
    const result = validateQuickSignContent(30023, '# Heading\n- item\n[text](https://example.com)');

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects raw html for kind 30023 content helper', () => {
    const result = validateQuickSignContent(30023, '<article>Body</article>');

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Event content cannot contain raw HTML tags.');
  });

  it('rejects raw html for kind 1 content helper', () => {
    const result = validateQuickSignContent(1, 'hello<br />world');

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Event content cannot contain raw HTML tags.');
  });

  it('rejects content with raw html', () => {
    const result = validateQuickSignInput({
      accountAlias: 'alpha',
      kind: 30023,
      content: '<b>hello</b>',
      tags: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Event content cannot contain raw HTML tags.');
  });

  it('rejects unsupported tag type and empty tag value', () => {
    const result = validateQuickSignInput({
      accountAlias: 'alpha',
      kind: 30023,
      content: 'hello nostr',
      tags: [
        { type: 't', value: 'ok' },
        { type: 'x' as 't', value: '' },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Tag #2 has unsupported type.');
    expect(result.errors).toContain('Tag #2 value is required.');
  });

  it('builds preview event with sanitized pubkey and generated signature fields', () => {
    vi.setSystemTime(new Date('2026-05-20T00:00:00.000Z'));

    const prepared = buildQuickSignPreviewEvent('pubkey-test', {
      accountAlias: 'alpha',
      kind: 1,
      content: 'hello nostr',
      tags: [{ type: 'e', value: '123' }],
    });

    expect(prepared.validation.valid).toBe(true);
    expect(prepared.event).toMatchObject({
      kind: 1,
      content: 'hello nostr',
      pubkey: 'pubkey-test',
      tags: [['e', '123']],
      created_at: Math.floor(new Date('2026-05-20T00:00:00.000Z').getTime() / 1000),
    });
    expect('id' in prepared.event).toBe(false);
    expect('sig' in prepared.event).toBe(false);
    vi.useRealTimers();
  });

  it('lists quick sign accounts', async () => {
    await expect(listQuickSignAccounts()).resolves.toEqual([
      {
        label: `alpha (${'f'.repeat(64)})`,
        value: 'alpha',
        npub: 'f'.repeat(64),
      },
    ]);
  });

  it('flags publish mode as invalid when relay selection is empty', () => {
    const result = validateQuickSignInput({
      accountAlias: 'alpha',
      kind: 1,
      content: 'hello nostr',
      tags: [],
    }, {
      relayUrls: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Select at least one relay to publish.');
  });

  it('flags publish mode as invalid when relay url is malformed', () => {
    const result = validateQuickSignInput({
      accountAlias: 'alpha',
      kind: 1,
      content: 'hello nostr',
      tags: [],
    }, {
      relayUrls: ['https://relay.example'],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Relay URLs must be valid ws:// or wss:// URLs.');
  });

  it('lists selected account relay meta list relays and prefers write-capable markers', async () => {
    poolGetMock.mockResolvedValueOnce({
      kind: 10002,
      tags: [
        ['r', 'wss://write.example', 'write'],
        ['r', 'wss://read.example', 'read'],
      ],
    });

    await expect(listQuickSignAccountRelayUrls('alpha')).resolves.toEqual(['wss://write.example']);
  });

  it('deduplicates selected account relay meta list relays', async () => {
    poolGetMock.mockResolvedValueOnce({
      kind: 10002,
      tags: [
        ['r', 'wss://relay.example/'],
        ['r', 'wss://relay.example'],
      ],
    });

    await expect(listQuickSignAccountRelayUrls('alpha')).resolves.toEqual(['wss://relay.example']);
  });

  it('filters malformed relay urls from selected account relay meta list', async () => {
    poolGetMock.mockResolvedValueOnce({
      kind: 10002,
      tags: [
        ['r', 'bad-url'],
        ['r', 'wss://valid.example'],
      ],
    });

    await expect(listQuickSignAccountRelayUrls('alpha')).resolves.toEqual(['wss://valid.example']);
  });

  it('returns empty relay list when selected account has no relay meta list event', async () => {
    poolGetMock.mockResolvedValueOnce(null);

    await expect(listQuickSignAccountRelayUrls('alpha')).resolves.toEqual([]);
  });

  it('returns empty relay list for unknown account alias', async () => {
    await expect(listQuickSignAccountRelayUrls('unknown')).resolves.toEqual([]);
    expect(poolGetMock).not.toHaveBeenCalled();
  });

  it('returns empty relay list when no fallback relays are available for metadata lookup', async () => {
    settingsStoreMock.fallbackRelays = [];

    await expect(listQuickSignAccountRelayUrls('alpha')).resolves.toEqual([]);
    expect(poolGetMock).not.toHaveBeenCalled();
  });
});
