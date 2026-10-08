import { describe, it, expect, vi, beforeEach } from 'vitest';
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
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
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

import ProfileView from '@/components/shared/ProfileView.vue';

const STORED_KEY = {
  id: 'a'.repeat(64),
  alias: 'alice',
  account: { privkey: 'b'.repeat(64) },
  createdAt: '2026-01-01T00:00:00.000Z',
};

const mountView = async () => {
  const wrapper = mount(ProfileView, {
    props: { storedKey: STORED_KEY },
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
