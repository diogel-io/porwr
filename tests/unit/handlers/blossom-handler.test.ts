import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BLOSSOM_AUTH_TTL_SECONDS,
  handleBlossomUpload,
} from '@/../src-bex/handlers/blossom-handler';
import { handleVaultGetData, handleVaultIsUnlocked } from '@/../src-bex/handlers/vault-handler';
import { storageService, NOSTR_ACTIVE, BLOSSOM_UPLOAD_STATUS } from '@/services/storage-service';
import { finalizeEvent, getPublicKey } from 'nostr-tools';

// Mock dependencies
vi.mock('@/../src-bex/handlers/vault-handler', () => ({
  handleVaultIsUnlocked: vi.fn(),
  handleVaultGetData: vi.fn(),
}));

vi.mock('@/services/storage-service', () => ({
  storageService: {
    get: vi.fn(),
    set: vi.fn(),
  },
  NOSTR_ACTIVE: 'nostr_active_account',
  BLOSSOM_UPLOAD_STATUS: 'blossom_upload_status',
}));

vi.mock('nostr-tools', () => ({
  finalizeEvent: vi.fn(),
  getPublicKey: vi.fn(),
}));

vi.mock('@noble/hashes/utils', () => ({
  hexToBytes: vi.fn((hex) => Buffer.from(hex, 'hex')),
}));

vi.mock('@noble/hashes/sha2.js', () => ({
  sha256: vi.fn(() => new Uint8Array(32)),
}));

vi.mock('@/services/log-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/log-service')>();
  return {
    ...actual,
    logService: {
      ...actual.logService,
      log: vi.fn(),
      logException: vi.fn(),
    },
  };
});

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock global atob
global.atob = vi.fn((base64) => Buffer.from(base64, 'base64').toString('binary'));
// Mock global btoa
global.btoa = vi.fn((str) => Buffer.from(str, 'binary').toString('base64'));

describe('BlossomHandler', () => {
  const mockAccount = {
    id: 'test-pubkey',
    alias: 'test-alias',
    createdAt: String(Date.now()),
    account: {
      privkey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
  };

  const payload = {
    base64Data: 'SGVsbG8=', // "Hello"
    fileType: 'text/plain',
    blossomServer: 'https://blossom.example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ url: 'https://blossom.example.com/file.txt' }),
      text: () => Promise.resolve(JSON.stringify({ url: 'https://blossom.example.com/file.txt' })),
    });
    vi.mocked(handleVaultIsUnlocked).mockResolvedValue({ success: true, data: true });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(storageService.get).mockImplementation(((key: string) => {
      if (key === NOSTR_ACTIVE) return Promise.resolve('test-alias');
      return Promise.resolve(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    vi.mocked(handleVaultGetData).mockResolvedValue({
      success: true,
      data: {
        vaultData: {
          accounts: [mockAccount],
        },
      },
    });
    vi.mocked(getPublicKey).mockReturnValue('test-pubkey');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(finalizeEvent).mockReturnValue({ id: 'event-id', sig: 'event-sig' } as any);
  });

  it('should upload successfully', async () => {
    const result = await handleBlossomUpload(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('https://blossom.example.com/file.txt');
    }
    expect(mockFetch).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(storageService.set).toHaveBeenCalledWith(
      BLOSSOM_UPLOAD_STATUS,
      expect.objectContaining({
        uploading: false,
        url: 'https://blossom.example.com/file.txt',
      }),
    );
  });

  it('should return error when vault is locked', async () => {
    vi.mocked(handleVaultIsUnlocked).mockResolvedValue({ success: true, data: false });

    const result = await handleBlossomUpload(payload);

    expect(result.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(storageService.set).toHaveBeenCalledWith(
      BLOSSOM_UPLOAD_STATUS,
      expect.objectContaining({
        uploading: false,
        error: 'failed',
      }),
    );
  });

  it('should handle fetch failure and retry', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Error',
        text: () => Promise.resolve('error'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ url: 'https://blossom.example.com/retry.txt' }),
        text: () =>
          Promise.resolve(JSON.stringify({ url: 'https://blossom.example.com/retry.txt' })),
      });

    const result = await handleBlossomUpload(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('https://blossom.example.com/retry.txt');
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should return error when all upload attempts fail', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Error',
      text: () => Promise.resolve('error'),
    });

    const result = await handleBlossomUpload(payload);

    expect(result.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(storageService.set).toHaveBeenCalledWith(
      BLOSSOM_UPLOAD_STATUS,
      expect.objectContaining({ uploading: false, error: 'failed' }),
    );
  });

  describe('the stored status names a failure, never repeats it (porwr#370)', () => {
    const SERVER_TEXT = 'balance 4200 sats; contact admin@blossom.example.com';
    const refuse = (status: number) =>
      mockFetch.mockResolvedValue({
        ok: false,
        status,
        statusText: 'Refused',
        text: () => Promise.resolve(SERVER_TEXT),
      });
    const storedStatus = () =>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(storageService.set).mock.calls.at(-1)?.[1] as { error: unknown };

    it.each([
      [413, 'too_large'],
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [500, 'failed'],
    ])('records an HTTP %i refusal as %s, without the server’s text', async (status, code) => {
      refuse(status);

      const result = await handleBlossomUpload(payload);

      expect(result.success).toBe(false);
      expect(storedStatus().error).toBe(code);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(JSON.stringify(vi.mocked(storageService.set).mock.calls)).not.toContain('admin@');
    });

    it('records a media URL that is not https as not_https', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ url: 'http://blossom.example.com/x.png' })),
      });

      await handleBlossomUpload(payload);

      expect(storedStatus().error).toBe('not_https');
    });

    it('records a network failure as failed', async () => {
      mockFetch.mockRejectedValue(new TypeError('connect ECONNREFUSED 10.0.0.7:443'));

      await handleBlossomUpload(payload);

      expect(storedStatus().error).toBe('failed');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(JSON.stringify(vi.mocked(storageService.set).mock.calls)).not.toContain('10.0.0.7');
    });
  });

  describe('the account the upload is for (porwr#417)', () => {
    it('uploads when the named account is still the active one', async () => {
      const result = await handleBlossomUpload({ ...payload, accountPubkey: 'test-pubkey' });

      expect(result.success).toBe(true);
      expect(finalizeEvent).toHaveBeenCalledTimes(1);
    });

    it('signs and sends nothing once another account has become active', async () => {
      const result = await handleBlossomUpload({ ...payload, accountPubkey: 'other-pubkey' });

      expect(result.success).toBe(false);
      expect(finalizeEvent).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('BUD-11 authorisation (diogel-io/workspace#142, T21)', () => {
    const tagsOf = (call: number) =>
      (vi.mocked(finalizeEvent).mock.calls[call]![0] as { tags: string[][] }).tags;

    it('signs one kind 24242 token with t, x, size, server and a short expiration', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);

      await handleBlossomUpload(payload);

      expect(finalizeEvent).toHaveBeenCalledTimes(1);
      const template = vi.mocked(finalizeEvent).mock.calls[0]![0] as {
        kind: number;
        content: string;
      };
      expect(template.kind).toBe(24242);
      expect(template.content).toBe('Upload file');
      const tags = tagsOf(0);
      expect(tags).toContainEqual(['t', 'upload']);
      expect(tags).toContainEqual(['x', '0'.repeat(64)]);
      expect(tags).toContainEqual(['size', '5']);
      expect(tags).toContainEqual(['server', 'blossom.example.com']);
      expect(tags).toContainEqual(['expiration', String(1_800_000_000 + BLOSSOM_AUTH_TTL_SECONDS)]);
      expect(tags.map(([name]) => name)).not.toContain('u');
      expect(tags.map(([name]) => name)).not.toContain('method');
      now.mockRestore();
    });

    it('reuses the one token for every endpoint it tries', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Error',
        text: () => Promise.resolve('error'),
      });

      await handleBlossomUpload(payload);

      expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
      expect(finalizeEvent).toHaveBeenCalledTimes(1);
      const headers = mockFetch.mock.calls.map(
        ([, init]) => (init as { headers: Record<string, string> }).headers.Authorization,
      );
      expect(new Set(headers).size).toBe(1);
    });

    it('builds every endpoint from the validated URL, not the raw setting', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Error',
        text: () => Promise.resolve('error'),
      });

      await handleBlossomUpload({ ...payload, blossomServer: '  https://Blossom.Example.COM  ' });

      const urls = mockFetch.mock.calls.map(([url]) => String(url));
      expect(urls[0]).toBe('https://blossom.example.com/upload');
      for (const url of urls) {
        expect(url.startsWith('https://blossom.example.com/')).toBe(true);
      }
    });

    it('fails an upload whose server answers with a non-https media URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ url: 'http://blossom.example.com/file.txt' })),
      });

      const result = await handleBlossomUpload(payload);

      expect(result.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(storageService.set).toHaveBeenLastCalledWith(
        BLOSSOM_UPLOAD_STATUS,
        expect.objectContaining({
          uploading: false,
          url: null,
          error: expect.stringContaining('https'),
        }),
      );
    });

    it('never follows a redirect, which would resend the file elsewhere', async () => {
      await handleBlossomUpload(payload);

      for (const [, init] of mockFetch.mock.calls) {
        expect((init as RequestInit).redirect).toBe('error');
      }
    });

    it('names the server by its lowercase bare hostname', async () => {
      await handleBlossomUpload({ ...payload, blossomServer: 'https://Media.Example.ORG:8443/b/' });

      expect(tagsOf(0)).toContainEqual(['server', 'media.example.org']);
    });

    it.each(['http://blossom.example.com', 'ftp://blossom.example.com', 'not a url'])(
      'refuses %s before signing or sending anything',
      async (blossomServer) => {
        const result = await handleBlossomUpload({ ...payload, blossomServer });

        expect(result.success).toBe(false);
        expect(finalizeEvent).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(storageService.set).not.toHaveBeenCalled();
      },
    );
  });
});
