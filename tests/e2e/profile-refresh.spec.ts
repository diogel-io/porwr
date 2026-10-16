import { expect, test } from './fixtures/extension';
import { createVault, seedAccount } from './fixtures/vault';

/**
 * The cross-context signal behind the panel's profile refresh (#201).
 *
 * The dashboard editor and the panel are separate page contexts. Nothing in one hears about a save
 * in the other, so `ProfileView` listens for a storage write instead of a message: the panel port
 * cannot serve this, being one connection per panel that the background counts for presence (#113),
 * and this component also renders on the extension index page.
 *
 * What is asserted here is the platform assumption the whole approach rests on — that
 * `chrome.storage.onChanged` fires in a *different* extension page from the one that wrote. That it
 * is written after a successful publish, and not after a failed one, is covered by unit tests
 * against `profileService`; publishing needs relays, which this harness has none of.
 */
test.describe('a profile change in one surface reaches another', () => {
  test('storage.onChanged fires in the panel for a write from the dashboard', async ({
    openPage,
  }) => {
    const setup = await openPage('/login');
    await createVault(setup);
    await seedAccount(setup);

    const panel = await openPage('/sidebar');
    await panel.locator('.sidebar-root').waitFor({ state: 'visible', timeout: 20_000 });

    // Listen in the panel, exactly as ProfileView does.
    await panel.evaluate(() => {
      const seen: unknown[] = [];
      (window as unknown as { __seen: unknown[] }).__seen = seen;
      chrome.storage.onChanged.addListener((changes) => {
        if (changes['profile:updated']) seen.push(changes['profile:updated'].newValue);
      });
    });

    // Write from the other page. A same-context write would prove nothing.
    const written = { pubkey: 'a'.repeat(64), at: Date.now() };
    await setup.evaluate(
      (value) => chrome.storage.local.set({ 'profile:updated': value }),
      written,
    );

    await expect
      .poll(
        () => panel.evaluate(() => (window as unknown as { __seen: unknown[] }).__seen.length),
        {
          timeout: 10_000,
        },
      )
      .toBe(1);

    const seen = await panel.evaluate(() => (window as unknown as { __seen: unknown[] }).__seen[0]);
    expect(seen).toMatchObject({ pubkey: written.pubkey });
  });
});
