import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoadedSettings } from '../mocks/remote-images';
import { flushPromises, mount } from '@vue/test-utils';

import ProfileImage from '@/components/dashboard/ProfileImage.vue';
import type { NostrProfile } from '@/types';
import type { AccountSummary } from '@/types/accounts';

const { fetchProfileMock, saveProfileMock, notifyMock, storageMock } = vi.hoisted(() => ({
  fetchProfileMock: vi.fn(),
  saveProfileMock: vi.fn(),
  notifyMock: vi.fn(),
  storageMock: { onChanged: vi.fn(), removeOnChanged: vi.fn() },
}));

vi.mock('@/services/profile-service', () => ({
  profileService: { fetchProfile: fetchProfileMock, saveProfile: saveProfileMock },
}));

vi.mock('@/services/storage-service', () => ({
  PROFILE_UPDATED_KEY: 'profile:updated',
  storageService: storageMock,
}));

vi.mock('quasar', () => ({ useQuasar: () => ({ notify: notifyMock }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const storedKey: AccountSummary = { id: 'pubkey-1', alias: 'alpha', createdAt: '2026-01-01' };

// Stands in for the uploader: the header's job is what it does with an uploaded URL.
const ImageUploaderStub = {
  name: 'ImageUploader',
  props: ['uploadId', 'text', 'label', 'storedKey'],
  emits: ['avatar-uploaded', 'banner-uploaded'],
  template: '<button class="uploader-stub" :data-upload-id="uploadId">{{ text }}</button>',
};

async function mountHeader(profile: NostrProfile | null) {
  fetchProfileMock.mockResolvedValue(profile);
  const wrapper = mount(ProfileImage, {
    props: { storedKey },
    global: { stubs: { ImageUploader: ImageUploaderStub, 'q-spinner': true, 'q-icon': true } },
  });
  await flushPromises();
  return wrapper;
}

function uploader(wrapper: Awaited<ReturnType<typeof mountHeader>>, id: 'avatar' | 'banner') {
  const found = wrapper
    .findAllComponents(ImageUploaderStub)
    .find((component) => component.props('uploadId') === id);
  if (!found) throw new Error(`no ${id} uploader`);
  return found;
}

/** Fires the storage listener the header registered, as `chrome.storage.onChanged` would. */
function signalProfileUpdated(pubkey: string) {
  const listener = storageMock.onChanged.mock.calls[0]?.[0] as
    ((changes: Record<string, chrome.storage.StorageChange>) => void) | undefined;
  listener?.({ 'profile:updated': { newValue: { pubkey, at: 1 } } });
}

describe('ProfileImage.vue', () => {
  beforeEach(() => {
    useLoadedSettings();
    vi.clearAllMocks();
    saveProfileMock.mockResolvedValue(undefined);
  });

  it('shows the display name and handle under the avatar', async () => {
    const wrapper = await mountHeader({ name: 'alice', display_name: 'Alice' });

    expect(wrapper.find('.profile-header__title').text()).toBe('Alice');
    expect(wrapper.find('.profile-header__handle').text()).toBe('@alice');
  });

  it('labels both image actions, so neither is a bare icon over a picture', async () => {
    const wrapper = await mountHeader(null);

    expect(uploader(wrapper, 'avatar').props('text')).toBe('profile.avatarTitle');
    expect(uploader(wrapper, 'banner').props('text')).toBe('profile.bannerTitle');
  });

  it('publishes an uploaded avatar as that one field, through the profile service', async () => {
    const wrapper = await mountHeader({ name: 'alice', picture: 'https://example.com/old.png' });

    uploader(wrapper, 'avatar').vm.$emit(
      'avatar-uploaded',
      'https://example.com/new.png',
      'pubkey-1',
    );
    await flushPromises();

    expect(saveProfileMock).toHaveBeenCalledWith('pubkey-1', {
      picture: 'https://example.com/new.png',
    });
    expect(wrapper.find('.profile-header__avatar-image').attributes('src')).toBe(
      'https://example.com/new.png',
    );
  });

  it('publishes an uploaded banner as that one field', async () => {
    const wrapper = await mountHeader({ name: 'alice' });

    uploader(wrapper, 'banner').vm.$emit(
      'banner-uploaded',
      'https://example.com/banner.png',
      'pubkey-1',
    );
    await flushPromises();

    expect(saveProfileMock).toHaveBeenCalledWith('pubkey-1', {
      banner: 'https://example.com/banner.png',
    });
  });

  it('publishes an upload to the account it started for after a switch, not the one shown (#400)', async () => {
    const wrapper = await mountHeader({ name: 'alice' });
    const other: AccountSummary = { id: 'pubkey-2', alias: 'beta', createdAt: '2026-01-01' };
    fetchProfileMock.mockResolvedValue({ name: 'bob', banner: 'https://example.com/bob.png' });
    await wrapper.setProps({ storedKey: other });
    await flushPromises();

    // The upload began while alpha was shown and finishes now beta is.
    uploader(wrapper, 'banner').vm.$emit(
      'banner-uploaded',
      'https://example.com/alice-banner.png',
      'pubkey-1',
    );
    await flushPromises();

    expect(saveProfileMock).toHaveBeenCalledTimes(1);
    expect(saveProfileMock).toHaveBeenCalledWith('pubkey-1', {
      banner: 'https://example.com/alice-banner.png',
    });
    expect(wrapper.find('.profile-header__banner-image').attributes('src')).toBe(
      'https://example.com/bob.png',
    );
  });

  it('leaves the header alone when a save for an account not shown fails, even after returning (#400)', async () => {
    let failSave: (reason: unknown) => void = () => undefined;
    saveProfileMock.mockImplementation(
      () => new Promise((_resolve, reject) => (failSave = reject)),
    );
    const wrapper = await mountHeader({ name: 'alice', banner: 'https://example.com/alice.png' });
    const other: AccountSummary = { id: 'pubkey-2', alias: 'beta', createdAt: '2026-01-01' };
    fetchProfileMock.mockResolvedValue({ name: 'bob', banner: 'https://example.com/bob.png' });
    await wrapper.setProps({ storedKey: other });
    await flushPromises();

    uploader(wrapper, 'banner').vm.$emit(
      'banner-uploaded',
      'https://example.com/alice-new.png',
      'pubkey-1',
    );
    fetchProfileMock.mockResolvedValue({ name: 'alice', banner: 'https://example.com/alice.png' });
    await wrapper.setProps({ storedKey });
    await flushPromises();
    failSave(new Error('no relay accepted it'));
    await flushPromises();

    expect(wrapper.find('.profile-header__banner-image').attributes('src')).toBe(
      'https://example.com/alice.png',
    );
  });

  it('keeps the uploaders while the header reloads for another account (#400)', async () => {
    const wrapper = await mountHeader({ name: 'alice' });
    const before = uploader(wrapper, 'banner');
    let finishFetch: (value: NostrProfile) => void = () => undefined;
    fetchProfileMock.mockImplementation(
      () => new Promise<NostrProfile>((resolve) => (finishFetch = resolve)),
    );

    await wrapper.setProps({
      storedKey: { id: 'pubkey-2', alias: 'beta', createdAt: '2026-01-01' },
    });
    await flushPromises();
    // Still loading beta: an upload alpha started finishes now.
    before.vm.$emit('banner-uploaded', 'https://example.com/alice-banner.png', 'pubkey-1');
    await flushPromises();
    finishFetch({ name: 'bob' });
    await flushPromises();

    expect(uploader(wrapper, 'banner').vm).toBe(before.vm);
    expect(saveProfileMock).toHaveBeenCalledWith('pubkey-1', {
      banner: 'https://example.com/alice-banner.png',
    });
  });

  it('says so when publishing an image fails, and goes back to the published one', async () => {
    saveProfileMock.mockRejectedValue(new Error('no relay accepted it'));
    const wrapper = await mountHeader({ name: 'alice', picture: 'https://example.com/old.png' });

    uploader(wrapper, 'avatar').vm.$emit(
      'avatar-uploaded',
      'https://example.com/new.png',
      'pubkey-1',
    );
    await flushPromises();

    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
    expect(wrapper.find('.profile-header__avatar-image').attributes('src')).toBe(
      'https://example.com/old.png',
    );
  });

  it('re-reads the profile when this account is published elsewhere, such as by the editor', async () => {
    const wrapper = await mountHeader({ name: 'alice', display_name: 'Alice' });
    fetchProfileMock.mockResolvedValue({ name: 'alice', display_name: 'Alice Renamed' });

    signalProfileUpdated('pubkey-1');
    await flushPromises();

    expect(wrapper.find('.profile-header__title').text()).toBe('Alice Renamed');
  });

  it('ignores a change to another account', async () => {
    await mountHeader({ name: 'alice' });

    signalProfileUpdated('someone-else');
    await flushPromises();

    expect(fetchProfileMock).toHaveBeenCalledTimes(1);
  });

  it('stops listening when it leaves the page', async () => {
    const wrapper = await mountHeader(null);
    const listener = storageMock.onChanged.mock.calls[0]?.[0];

    wrapper.unmount();

    expect(storageMock.removeOnChanged).toHaveBeenCalledWith(listener);
  });
});
