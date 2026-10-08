import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  listPageOrigins: vi.fn(),
  listPendingRequests: vi.fn(),
  interruptRequestsForOrigin: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@/../src-bex/services/page-origin-registry', () => ({
  listPageOrigins: mocks.listPageOrigins,
}));
vi.mock('@/../src-bex/services/request-queue', () => ({
  listPendingRequests: mocks.listPendingRequests,
  interruptRequestsForOrigin: mocks.interruptRequestsForOrigin,
}));
vi.mock('@/services/log-service', () => ({
  LogLevel: { ERROR: 'error' },
  logService: { log: mocks.log },
}));

import {
  findAbandonedOrigins,
  reconcileAbandonedRequests,
} from '@/../src-bex/services/page-reconciliation';

const held = (...origins: string[]): Map<number, { origin: string; windowId: number }> =>
  new Map(origins.map((origin, index) => [index, { origin, windowId: 1 }]));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listPageOrigins.mockReturnValue(held());
  mocks.listPendingRequests.mockResolvedValue([]);
  mocks.interruptRequestsForOrigin.mockResolvedValue([]);
});

describe('which origins have gone', () => {
  it('names one with a pending request and no tab', () => {
    expect(findAbandonedOrigins(['https://gone.example'], new Set())).toEqual([
      'https://gone.example',
    ]);
  });

  it('spares one that any tab still holds', () => {
    // A request record names an origin and no tab, so two tabs on the same origin are
    // indistinguishable. Interrupting while one is still open would strand a live page.
    expect(
      findAbandonedOrigins(['https://example.com'], new Set(['https://example.com'])),
    ).toEqual([]);
  });

  it('reports each origin once however many requests it has', () => {
    expect(
      findAbandonedOrigins(['https://a.example', 'https://a.example'], new Set()),
    ).toEqual(['https://a.example']);
  });

  it('says nothing when nothing is pending', () => {
    expect(findAbandonedOrigins([], new Set(['https://example.com']))).toEqual([]);
  });
});

describe('reconciling after a page goes', () => {
  it('interrupts requests for an origin no tab holds any more', async () => {
    mocks.listPageOrigins.mockReturnValue(held('https://still-open.example'));
    mocks.listPendingRequests.mockResolvedValue([
      { origin: 'https://gone.example' },
      { origin: 'https://still-open.example' },
    ]);

    const abandoned = await reconcileAbandonedRequests();

    expect(abandoned).toEqual(['https://gone.example']);
    expect(mocks.interruptRequestsForOrigin).toHaveBeenCalledExactlyOnceWith(
      'https://gone.example',
    );
  });

  it('interrupts nothing when every pending origin is still open', async () => {
    mocks.listPageOrigins.mockReturnValue(held('https://example.com'));
    mocks.listPendingRequests.mockResolvedValue([{ origin: 'https://example.com' }]);

    await reconcileAbandonedRequests();

    expect(mocks.interruptRequestsForOrigin).not.toHaveBeenCalled();
  });

  it('survives the queue being unreadable', async () => {
    // Runs from a browser event with no caller to return to, and a request left pending is still
    // bounded by its own expiry (D8).
    mocks.listPendingRequests.mockRejectedValue(new Error('storage gone'));

    await expect(reconcileAbandonedRequests()).resolves.toEqual([]);
    expect(mocks.log).toHaveBeenCalled();
  });

  it('treats a missing queue as nothing pending', async () => {
    mocks.listPendingRequests.mockResolvedValue(null);

    await expect(reconcileAbandonedRequests()).resolves.toEqual([]);
  });
});
