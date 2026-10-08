/**
 * Toolbar attention policy (ADR D4).
 *
 * Porwr never opens the panel by itself — both browsers require a user gesture — so the toolbar is
 * the only way to say that something is waiting while the panel is closed. `action.setBadgeText`
 * and `action.setTitle` need no permission, which keeps NFR-18 intact.
 *
 * The badge is not announced to assistive technology. While the panel is open, NFR-4 is carried by
 * the in-panel live region; while it is closed, the title is the accessible carrier, which is why
 * it names the count in words rather than relying on the badge alone.
 */

import { LogLevel, logService } from '@/services/log-service';
import { getPendingCount } from './request-queue';

const BADGE_BACKGROUND = '#f2c037';
const BADGE_TEXT_COLOR = '#0b1220';

/** Two digits is all the toolbar reliably shows; beyond that the title carries the real number. */
const MAX_BADGE_COUNT = 99;

const DEFAULT_TITLE = 'Diogel';

const formatBadge = (count: number): string => {
  if (count <= 0) return '';
  return count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count);
};

const formatTitle = (count: number): string => {
  if (count <= 0) return DEFAULT_TITLE;
  return count === 1
    ? `${DEFAULT_TITLE} - 1 request waiting for your decision`
    : `${DEFAULT_TITLE} - ${count} requests waiting for your decision`;
};

export const renderAttention = async (count: number): Promise<void> => {
  const action = chrome.action;
  if (!action) return;

  try {
    await action.setBadgeText({ text: formatBadge(count) });
    await action.setTitle({ title: formatTitle(count) });

    // Only meaningful when a badge is showing, and harmless to set when one is not.
    await action.setBadgeBackgroundColor?.({ color: BADGE_BACKGROUND });
    await action.setBadgeTextColor?.({ color: BADGE_TEXT_COLOR });
  } catch (error: unknown) {
    logService.log(LogLevel.DEBUG, '[Attention] Failed to render toolbar state', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Re-read the queue and mirror it onto the toolbar.
 *
 * Sourced from the queue's own accessor rather than a separate count, so the toolbar and the
 * panel header can never disagree about what is waiting.
 */
export const refreshAttention = async (): Promise<void> => {
  try {
    await renderAttention(await getPendingCount());
  } catch (error: unknown) {
    logService.log(LogLevel.DEBUG, '[Attention] Failed to read the queue', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
