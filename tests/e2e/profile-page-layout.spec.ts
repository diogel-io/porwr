import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/extension';
import { createVault, seedAccount } from './fixtures/vault';

/**
 * The Profile page's avatar is shown whole, at a size that reads as an avatar (#200).
 *
 * Before #200 a fixed 150px avatar sat in a quarter-width column of a card with `overflow: hidden`,
 * so below a 1440px tab it was cut off and nothing on the page showed it. The avatar was present the
 * whole time: what is asserted here is its rendered size and that no box around it clips it, which
 * is the mistake #188 caught in the panel header.
 */

/** Below this the avatar stops reading as a picture of someone. The header's own floor is 64px. */
const MIN_AVATAR_PX = 60;

const openProfile = async (openPage: (hash: string) => Promise<Page>, width: number) => {
  const page = await openPage('/login');
  await createVault(page);
  await seedAccount(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(page.url().replace(/#.*$/, '#/profile'));
  // The header waits on a relay query; each relay is bounded by the pool's own timeouts.
  await page.locator('.profile-header__avatar').waitFor({ state: 'visible', timeout: 30_000 });
  return page;
};

/**
 * The avatar's rendered box, and every ancestor that would clip it and does not contain it.
 * Walking the ancestors rather than checking one named card is the point: the old defect's clip
 * came from a card two levels up, not from the avatar's own container.
 */
const measureAvatar = (page: Page) =>
  page.evaluate(() => {
    const avatar = document.querySelector('.profile-header__avatar');
    if (!avatar) return null;
    const box = avatar.getBoundingClientRect();
    const clippedBy: string[] = [];
    for (let el = avatar.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const clip = el.getBoundingClientRect();
      const tolerance = 1;
      const contained =
        box.left >= clip.left - tolerance &&
        box.right <= clip.right + tolerance &&
        box.top >= clip.top - tolerance &&
        box.bottom <= clip.bottom + tolerance;
      if (!contained) clippedBy.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
    }
    const root = document.scrollingElement ?? document.documentElement;
    return {
      width: Math.round(box.width),
      height: Math.round(box.height),
      clippedBy,
      pageOverflows: root.scrollWidth > root.clientWidth,
    };
  });

test.describe('the Profile page avatar', () => {
  // 1100 is a 1440px screen with the side panel open, where the old avatar lost ~51px; 1280 lost
  // ~24px; 1440 was the one width it fitted; 380 is a single column below every breakpoint.
  for (const width of [380, 1100, 1280, 1440]) {
    test(`is shown whole at ${width}px`, async ({ openPage }) => {
      const page = await openProfile(openPage, width);

      const avatar = await measureAvatar(page);

      expect(avatar).not.toBeNull();
      expect(avatar!.width).toBeGreaterThanOrEqual(MIN_AVATAR_PX);
      // Round: a square box. An avatar squeezed in one direction is clipped by another name.
      expect(Math.abs(avatar!.width - avatar!.height)).toBeLessThanOrEqual(1);
      expect(avatar!.clippedBy).toEqual([]);
      expect(avatar!.pageOverflows).toBe(false);
    });
  }
});

test('the Profile page has no preview of its own', async ({ openPage }) => {
  const page = await openProfile(openPage, 1100);

  // The side panel shows the profile (#201). The editor and the NIP-05 section must still be here,
  // or the absence below would prove nothing about the page having loaded.
  await expect(page.getByText('Profile Details', { exact: true })).toBeVisible();
  await expect(page.getByText('Identity & Payments', { exact: true })).toBeVisible();
  await expect(page.getByText('Profile Preview', { exact: true })).toHaveCount(0);
});
