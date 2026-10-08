import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayCatalogEntry, RelayDiscoveryState } from '@/types/relay';

const mockSendBexMessage = vi.fn();

vi.mock('@/services/vault-service', () => ({
  sendBexMessage: mockSendBexMessage,
}));

describe('relay-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listRelayCatalog', () => {
    it('returns the catalog entries from the background', async () => {
      const entries = [{ url: 'wss://relay.damus.io', hostname: 'relay.damus.io' }] as RelayCatalogEntry[];
      mockSendBexMessage.mockResolvedValue(entries);

      const { listRelayCatalog } = await import('@/services/relay-service');
      await expect(listRelayCatalog()).resolves.toEqual(entries);
      expect(mockSendBexMessage).toHaveBeenCalledWith('relay.browser.list');
    });

    it('returns an empty array when the background responds with nothing', async () => {
      mockSendBexMessage.mockResolvedValue(undefined);

      const { listRelayCatalog } = await import('@/services/relay-service');
      await expect(listRelayCatalog()).resolves.toEqual([]);
    });

    it('returns an empty array when the bridge call throws', async () => {
      mockSendBexMessage.mockRejectedValue(new Error('bridge down'));

      const { listRelayCatalog } = await import('@/services/relay-service');
      await expect(listRelayCatalog()).resolves.toEqual([]);
    });
  });

  describe('refreshRelayCatalog', () => {
    it('forwards the force flag to the background', async () => {
      mockSendBexMessage.mockResolvedValue(undefined);

      const { refreshRelayCatalog } = await import('@/services/relay-service');
      await refreshRelayCatalog(true);

      expect(mockSendBexMessage).toHaveBeenCalledWith('relay.browser.refresh', { force: true });
    });

    it('defaults force to false', async () => {
      mockSendBexMessage.mockResolvedValue(undefined);

      const { refreshRelayCatalog } = await import('@/services/relay-service');
      await refreshRelayCatalog();

      expect(mockSendBexMessage).toHaveBeenCalledWith('relay.browser.refresh', { force: false });
    });

    it('swallows errors from the bridge without throwing', async () => {
      mockSendBexMessage.mockRejectedValue(new Error('bridge down'));

      const { refreshRelayCatalog } = await import('@/services/relay-service');
      await expect(refreshRelayCatalog()).resolves.toBeUndefined();
    });
  });

  describe('getRelayDiscoveryStatus', () => {
    it('returns the discovery status from the background', async () => {
      const status = { id: 'global', lastGlobalDiscoveryAt: 1, isDiscoveryInProgress: false, updatedAt: 1 } as RelayDiscoveryState;
      mockSendBexMessage.mockResolvedValue(status);

      const { getRelayDiscoveryStatus } = await import('@/services/relay-service');
      await expect(getRelayDiscoveryStatus()).resolves.toEqual(status);
    });

    it('returns null when the background responds with nothing', async () => {
      mockSendBexMessage.mockResolvedValue(undefined);

      const { getRelayDiscoveryStatus } = await import('@/services/relay-service');
      await expect(getRelayDiscoveryStatus()).resolves.toBeNull();
    });

    it('returns null when the bridge call throws', async () => {
      mockSendBexMessage.mockRejectedValue(new Error('bridge down'));

      const { getRelayDiscoveryStatus } = await import('@/services/relay-service');
      await expect(getRelayDiscoveryStatus()).resolves.toBeNull();
    });
  });
});
