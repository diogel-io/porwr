import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleBlossomUpload } from '@/../src-bex/handlers/blossom-handler';
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
    expect(storageService.set).toHaveBeenCalledWith(BLOSSOM_UPLOAD_STATUS, expect.objectContaining({
      uploading: false,
      url: 'https://blossom.example.com/file.txt',
    }));
  });

  it('should return error when vault is locked', async () => {
    vi.mocked(handleVaultIsUnlocked).mockResolvedValue({ success: true, data: false });

    const result = await handleBlossomUpload(payload);

    expect(result.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(storageService.set).toHaveBeenCalledWith(BLOSSOM_UPLOAD_STATUS, expect.objectContaining({
      uploading: false,
      error: 'No active account found',
    }));
  });

  it('should handle fetch failure and retry', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Error', text: () => Promise.resolve('error') })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ url: 'https://blossom.example.com/retry.txt' }),
        text: () => Promise.resolve(JSON.stringify({ url: 'https://blossom.example.com/retry.txt' })),
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
    expect(storageService.set).toHaveBeenCalledWith(BLOSSOM_UPLOAD_STATUS, expect.objectContaining({
      uploading: false,
      error: expect.stringContaining('HTTP Error 500'),
    }));
  });
});
