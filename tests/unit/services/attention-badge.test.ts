import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getPendingCount } = vi.hoisted(() => ({ getPendingCount: vi.fn() }));

vi.mock('@/../src-bex/services/request-queue', () => ({ getPendingCount }));
vi.mock('@/services/log-service', () => ({
  LogLevel: { DEBUG: 'debug' },
  logService: { log: vi.fn() },
}));

import { refreshAttention, renderAttention } from '@/../src-bex/services/attention-badge';

const setBadgeText = vi.fn(async (_details: { text: string }) => undefined);
const setTitle = vi.fn(async (_details: { title: string }) => undefined);
const setBadgeBackgroundColor = vi.fn(async () => undefined);
const setBadgeTextColor = vi.fn(async () => undefined);

const lastText = (): string | undefined => setBadgeText.mock.calls.at(-1)?.[0].text;
const lastTitle = (): string | undefined => setTitle.mock.calls.at(-1)?.[0].title;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', {
    action: { setBadgeText, setTitle, setBadgeBackgroundColor, setBadgeTextColor },
  });
});

describe('toolbar attention (D4)', () => {
  describe('the badge', () => {
    it('shows nothing when the queue is empty', async () => {
      await renderAttention(0);

      expect(lastText()).toBe('');
    });

    it('shows the count', async () => {
      await renderAttention(3);

      expect(lastText()).toBe('3');
    });

    it('caps at what the toolbar can actually show', async () => {
      await renderAttention(1234);

      expect(lastText()).toBe('99+');
    });

    it('treats a negative count as empty rather than rendering it', async () => {
      await renderAttention(-1);

      expect(lastText()).toBe('');
    });
  });

  describe('the title', () => {
    it('is the accessible carrier while the panel is closed, so it names the count in words', async () => {
      await renderAttention(1);
      expect(lastTitle()).toBe('Diogel - 1 request waiting for your decision');

      await renderAttention(4);
      expect(lastTitle()).toBe('Diogel - 4 requests waiting for your decision');
    });

    it('carries the real number even when the badge is capped', async () => {
      await renderAttention(1234);

      expect(lastTitle()).toContain('1234');
    });

    it('returns to the plain name when nothing is waiting', async () => {
      await renderAttention(0);

      expect(lastTitle()).toBe('Diogel');
    });
  });

  describe('sourcing', () => {
    it('reads the queue rather than being told a count', async () => {
      getPendingCount.mockResolvedValue(2);

      await refreshAttention();

      // The toolbar and the panel header must never disagree about what is waiting.
      expect(getPendingCount).toHaveBeenCalled();
      expect(lastText()).toBe('2');
    });

    it('survives the queue read failing', async () => {
      getPendingCount.mockRejectedValue(new Error('storage gone'));

      await expect(refreshAttention()).resolves.toBeUndefined();
    });

    it('survives a browser with no action API', async () => {
      vi.stubGlobal('chrome', {});

      await expect(renderAttention(1)).resolves.toBeUndefined();
    });

    it('survives setBadgeTextColor being unavailable, as it is on Firefox', async () => {
      vi.stubGlobal('chrome', { action: { setBadgeText, setTitle } });

      await expect(renderAttention(1)).resolves.toBeUndefined();
      expect(lastText()).toBe('1');
    });
  });
});
