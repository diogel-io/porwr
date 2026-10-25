import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLoadedSettings } from '../mocks/remote-images';
import { mount, flushPromises } from '@vue/test-utils';

/**
 * The profile card the panel shows (#201).
 *
 * It displayed strictly less than the dashboard's preview did — no nip05, Lightning address, bot
 * flag or birthday — which made removing the dashboard copy a loss of information rather than a
 * de-duplication. These cover the fields it gained and the refresh that keeps them current.
 */

const state = vi.hoisted(() => ({
  profile: {} as Record<string, unknown>,
  storageHandlers: [] as Array<(changes: Record<string, unknown>) => void>,
  set: vi.fn(),
  removeOnChanged: vi.fn(),
  fetchProfile: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({ notify: state.notify }),
}));

vi.mock('@/services/profile-service', () => ({
  profileService: { fetchProfile: state.fetchProfile },
}));

vi.mock('@/services/storage-service', () => ({
  PROFILE_UPDATED_KEY: 'profile:updated',
  storageService: {
    set: state.set,
    onChanged: (handler: (changes: Record<string, unknown>) => void) => {
      state.storageHandlers.push(handler);
    },
    removeOnChanged: state.removeOnChanged,
  },
}));

import * as nip19 from 'nostr-tools/nip19';
import ProfileView from '@/components/shared/ProfileView.vue';

const STORED_KEY = {
  id: 'a'.repeat(64),
  alias: 'alice',
  account: { privkey: 'b'.repeat(64) },
  createdAt: '2026-01-01T00:00:00.000Z',
};

const mountView = async (storedKey = STORED_KEY) => {
  const wrapper = mount(ProfileView, {
    props: { storedKey },
    global: {
      // The export-keys warning uses the global `$t`, not the composable, so both need providing.
      mocks: { $t: (key: string) => key },
      stubs: {
        'q-card': { template: '<div><slot /></div>' },
        'q-card-section': { template: '<div><slot /></div>' },
        'q-card-actions': { template: '<div><slot /></div>' },
        'q-img': { template: '<img />' },
        'q-avatar': { template: '<div><slot /></div>' },
        'q-icon': { template: '<i />' },
        'q-btn': { template: '<button><slot /></button>' },
        'q-tooltip': { template: '<span><slot /></span>' },
        'q-spinner': { template: '<span />' },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  useLoadedSettings();
  vi.clearAllMocks();
  state.storageHandlers = [];
  // Read at call time, not at mock-setup time: each test assigns `state.profile` after this runs.
  state.fetchProfile.mockImplementation(() => Promise.resolve(state.profile));
});

describe('the fields the panel was missing', () => {
  it('shows the nip05 identifier, Lightning address, bot flag and birthday', async () => {
    state.profile = {
      name: 'alice',
      nip05: 'alice@example.com',
      lud16: 'alice@wallet.example',
      bot: true,
      birthday: { year: 1990, month: 4, day: 7 },
    };

    const text = (await mountView()).text();

    expect(text).toContain('alice@example.com');
    expect(text).toContain('alice@wallet.example');
    expect(text).toContain('profile.previewBot');
    expect(text).toContain('1990-04-07');
  });

  it('formats a birthday with no year, which NIP-24 allows', async () => {
    state.profile = { name: 'alice', birthday: { month: 4, day: 7 } };

    expect((await mountView()).text()).toContain('04-07');
  });

  it('says so when nothing beyond the name has been published', async () => {
    state.profile = { name: 'alice' };

    // An empty gap cannot be told apart from a card that has not finished loading.
    expect((await mountView()).text()).toContain('profile.previewNoDetails');
  });

  it('does not claim there are no details when there is one', async () => {
    state.profile = { name: 'alice', nip05: 'alice@example.com' };

    expect((await mountView()).text()).not.toContain('profile.previewNoDetails');
  });
});

// The website is attacker-influenced and lands in a bound href, so only https: becomes a link (#373).
describe('the website link (#373)', () => {
  it('links a bare host over https', async () => {
    state.profile = { name: 'alice', website: 'alice.example' };

    const link = (await mountView()).find('a.website-link');

    expect(link.attributes('href')).toBe('https://alice.example/');
    expect(link.text()).toBe('alice.example');
  });

  it.each(['javascript:alert(1)', 'http://alice.example'])(
    'shows %j as text, with no link',
    async (website) => {
      state.profile = { name: 'alice', website };

      const wrapper = await mountView();

      expect(wrapper.find('a.website-link').exists()).toBe(false);
      expect(wrapper.text()).toContain(website);
    },
  );
});

describe('staying current with saves from another surface', () => {
  it('re-reads when this account’s profile is published elsewhere', async () => {
    state.profile = { name: 'alice' };
    await mountView();
    expect(state.fetchProfile).toHaveBeenCalledTimes(1);

    state.profile = { name: 'alice renamed' };
    state.storageHandlers.forEach((handler) =>
      handler({ 'profile:updated': { newValue: { pubkey: STORED_KEY.id, at: 1 } } }),
    );
    await flushPromises();

    expect(state.fetchProfile).toHaveBeenCalledTimes(2);
  });

  it('ignores a change to a different account', async () => {
    state.profile = { name: 'alice' };
    await mountView();

    state.storageHandlers.forEach((handler) =>
      handler({ 'profile:updated': { newValue: { pubkey: 'c'.repeat(64), at: 1 } } }),
    );
    await flushPromises();

    // Re-fetching here would hit the relays for every account on every save.
    expect(state.fetchProfile).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated storage writes', async () => {
    state.profile = { name: 'alice' };
    await mountView();

    state.storageHandlers.forEach((handler) => handler({ 'something:else': { newValue: 1 } }));
    await flushPromises();

    expect(state.fetchProfile).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes when unmounted', async () => {
    const wrapper = await mountView();

    wrapper.unmount();

    // The panel mounts and unmounts this card as the vault locks and unlocks; a listener left
    // behind would fetch on behalf of a component that is gone.
    expect(state.removeOnChanged).toHaveBeenCalledTimes(1);
  });
});

describe('the account npub (#303)', () => {
  const npub = nip19.npubEncode(STORED_KEY.id);
  const writeText = vi.fn();

  beforeEach(() => {
    useLoadedSettings();
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('shows the npub shortened, with the full value in its title', async () => {
    state.profile = { name: 'alice', display_name: 'Alice' };

    const button = (await mountView()).get('button.profile-npub');

    expect(button.text()).toContain(`${npub.slice(0, 14)}…${npub.slice(-10)}`);
    expect(button.text()).not.toContain(npub);
    expect(button.attributes('title')).toBe(npub);
    expect(button.attributes('type')).toBe('button');
  });

  it('shows it for an account that has never published a profile', async () => {
    state.profile = {};

    expect((await mountView()).find('button.profile-npub').exists()).toBe(true);
  });

  it('copies the full npub, not the shortened one', async () => {
    state.profile = { name: 'alice' };
    const wrapper = await mountView();

    await wrapper.get('button.profile-npub').trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith(npub);
    expect(state.notify).toHaveBeenCalledWith({
      type: 'positive',
      message: 'account.copySuccess',
    });
  });

  it('says so when the clipboard refuses the write', async () => {
    state.profile = { name: 'alice' };
    writeText.mockRejectedValue(new Error('denied'));
    const wrapper = await mountView();

    await wrapper.get('button.profile-npub').trigger('click');
    await flushPromises();

    expect(state.notify).toHaveBeenCalledWith({
      type: 'negative',
      message: 'keyManagement.table.copyPublicKeyFailed',
    });
  });

  it('follows an account switch', async () => {
    state.profile = { name: 'alice' };
    const wrapper = await mountView();
    const other = { ...STORED_KEY, id: 'c'.repeat(64), alias: 'bob' };

    await wrapper.setProps({ storedKey: other });
    await flushPromises();

    expect(wrapper.get('button.profile-npub').attributes('title')).toBe(nip19.npubEncode(other.id));
  });

  it('shows nothing for a key that cannot be encoded', async () => {
    state.profile = { name: 'alice' };

    const wrapper = await mountView({ ...STORED_KEY, id: 'not-hex' });

    expect(wrapper.find('button.profile-npub').exists()).toBe(false);
  });
});

describe('the empty banner (#301)', () => {
  it('shows a neutral placeholder with no shade when there is no banner', async () => {
    state.profile = { name: 'alice' };
    const wrapper = await mountView();

    expect(wrapper.find('.banner-placeholder').exists()).toBe(true);
    // The shade lifts an avatar off a picture; over an empty placeholder it is only a smudge.
    expect(wrapper.get('.banner-container').classes()).not.toContain('banner-container--has-image');
  });

  it('shades a banner image', async () => {
    state.profile = { name: 'alice', banner: 'https://example.com/banner.png' };
    const wrapper = await mountView();

    expect(wrapper.find('.banner-placeholder').exists()).toBe(false);
    expect(wrapper.get('.banner-container').classes()).toContain('banner-container--has-image');
  });
});
