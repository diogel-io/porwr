import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storageService, NOSTR_ACTIVE } from '@/services/storage-service';

// Mock chrome API
const chromeMock = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
    session: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

vi.stubGlobal('chrome', chromeMock);

describe('StorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should get a value from local storage', async () => {
    chromeMock.storage.local.get.mockResolvedValue({ [NOSTR_ACTIVE]: 'test-value' });

    const result = await storageService.get(NOSTR_ACTIVE);

    expect(chromeMock.storage.local.get).toHaveBeenCalledWith([NOSTR_ACTIVE]);
    expect(result).toBe('test-value');
  });

  it('should set a value in local storage', async () => {
    await storageService.set(NOSTR_ACTIVE, 'new-value');

    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({ [NOSTR_ACTIVE]: 'new-value' });
  });

  it('should get a value from session storage', async () => {
    chromeMock.storage.session.get.mockResolvedValue({ 'session-key': 'session-value' });

    const result = await storageService.get('session-key', 'session');

    expect(chromeMock.storage.session.get).toHaveBeenCalledWith(['session-key']);
    expect(result).toBe('session-value');
  });

  it('should set a value in session storage', async () => {
    await storageService.set('session-key', 'session-value', 'session');

    expect(chromeMock.storage.session.set).toHaveBeenCalledWith({ 'session-key': 'session-value' });
  });

  it('should remove a key', async () => {
    await storageService.remove(NOSTR_ACTIVE);
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith(NOSTR_ACTIVE);
  });

  it('should clear an area', async () => {
    await storageService.clear('local');
    expect(chromeMock.storage.local.clear).toHaveBeenCalled();
  });

  it('should add/remove onChanged listener', () => {
    const callback = vi.fn();
    storageService.onChanged(callback);
    expect(chromeMock.storage.onChanged.addListener).toHaveBeenCalledWith(callback);

    storageService.removeOnChanged(callback);
    expect(chromeMock.storage.onChanged.removeListener).toHaveBeenCalledWith(callback);
  });
});
