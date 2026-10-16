import type { Page } from '@playwright/test';

/**
 * How an empty banner is painted in each theme, against what `--surface-soft` resolves to (#301).
 *
 * Read from computed style because the regression is purely visual: an orange gradient renders
 * without error and every element is still present. The token is resolved through a probe element
 * rather than read as text, so the comparison is between two rendered colours.
 */
export interface BannerPaint {
  backgroundImage: string;
  backgroundColor: string;
  surfaceSoft: string;
}

export const readBannerPaint = (page: Page, selector: string, dark: boolean) =>
  page.evaluate(
    ({ selector, dark }) => {
      document.body.classList.toggle('body--dark', dark);
      document.body.classList.toggle('body--light', !dark);

      const banner = document.querySelector(selector);
      if (!banner) return null;
      const style = getComputedStyle(banner);

      const probe = document.createElement('div');
      probe.style.background = 'var(--surface-soft)';
      document.body.appendChild(probe);
      const surfaceSoft = getComputedStyle(probe).backgroundColor;
      probe.remove();

      return {
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor,
        surfaceSoft,
      } satisfies BannerPaint;
    },
    { selector, dark },
  );
