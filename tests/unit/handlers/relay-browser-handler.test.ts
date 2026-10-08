/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleRelayBrowserList,
  handleRelayBrowserGetStatus,
  handleRelayBrowserRefresh,
} from '@/../src-bex/handlers/relay-browser-handler';
import { relayCatalogService } from '@/services/relay-catalog';
import { relayBrowserOrchestrator } from '@/services/relay-browser-orchestrator';
import type { RelayCatalogEntry } from '@/types/relay';

// Mock dependencies
vi.mock('@/services/relay-catalog', () => ({
  relayCatalogService: {
    getEntries: vi.fn(),
    getDiscoveryState: vi.fn(),
  },
}));

vi.mock('@/services/relay-browser-orchestrator', () => ({
  relayBrowserOrchestrator: {
    refreshCatalog: vi.fn(),
  },
}));

vi.mock('@/services/database', () => ({
  db: {
    relayDiscoveryState: {
      get: vi.fn(),
    },
  },
}));

describe('RelayBrowserHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleRelayBrowserList', () => {
    it('should return cached relay entries successfully', async () => {
      const mockEntries = [
        { url: 'wss://relay1.com', hostname: 'relay1.com', status: 'online' },
        { url: 'wss://relay2.com', hostname: 'relay2.com', status: 'offline' },
      ];
      vi.mocked(relayCatalogService.getEntries).mockResolvedValue(mockEntries as unknown as RelayCatalogEntry[]);

      const result = await handleRelayBrowserList();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(mockEntries);
      }
      expect(vi.mocked(relayCatalogService.getEntries)).toHaveBeenCalled();
    });

    it('should return failure when service throws an error', async () => {
      vi.mocked(relayCatalogService.getEntries).mockRejectedValue(new Error('Database error'));

      const result = await handleRelayBrowserList();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Database error');
      }
    });
  });

  describe('handleRelayBrowserGetStatus', () => {
    it('should return discovery status successfully', async () => {
      const mockStatus = {
        id: 'global',
        lastGlobalDiscoveryAt: 123456789,
        isDiscoveryInProgress: false,
        updatedAt: 123456789,
      };
      vi.mocked(relayCatalogService.getDiscoveryState).mockResolvedValue(mockStatus as unknown as { id: string; lastGlobalDiscoveryAt: number; isDiscoveryInProgress: boolean; updatedAt: number });

      const result = await handleRelayBrowserGetStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(mockStatus);
      }
      expect(relayCatalogService.getDiscoveryState).toHaveBeenCalledWith('global');
    });

    it('should return null when no status exists in database', async () => {
      vi.mocked(relayCatalogService.getDiscoveryState).mockResolvedValue(null);

      const result = await handleRelayBrowserGetStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('should return failure when database access fails', async () => {
      vi.mocked(relayCatalogService.getDiscoveryState).mockRejectedValue(new Error('Read error'));

      const result = await handleRelayBrowserGetStatus();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Read error');
      }
    });
  });

  describe('handleRelayBrowserRefresh', () => {
    it('returns success immediately without awaiting the refresh, forwarding the force flag', async () => {
      let resolveRefresh!: () => void;
      vi.mocked(relayBrowserOrchestrator.refreshCatalog).mockReturnValue(
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      );

      const result = await handleRelayBrowserRefresh({ force: true });

      expect(result).toEqual({ success: true, data: undefined });
      expect(relayBrowserOrchestrator.refreshCatalog).toHaveBeenCalledWith(true);

      resolveRefresh();
    });

    it('defaults force to false when no payload is given', async () => {
      vi.mocked(relayBrowserOrchestrator.refreshCatalog).mockResolvedValue(undefined);

      await handleRelayBrowserRefresh();

      expect(relayBrowserOrchestrator.refreshCatalog).toHaveBeenCalledWith(false);
    });

    it('does not propagate a rejection from the background refresh (fire-and-forget)', async () => {
      vi.mocked(relayBrowserOrchestrator.refreshCatalog).mockRejectedValue(new Error('refresh failed'));

      const result = await handleRelayBrowserRefresh({ force: false });
      expect(result).toEqual({ success: true, data: undefined });

      // Let the fire-and-forget .catch() run before the test ends.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it('returns failure when triggering the refresh throws synchronously', async () => {
      vi.mocked(relayBrowserOrchestrator.refreshCatalog).mockImplementation(() => {
        throw new Error('orchestrator unavailable');
      });

      const result = await handleRelayBrowserRefresh({ force: true });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('orchestrator unavailable');
      }
    });
  });
});
