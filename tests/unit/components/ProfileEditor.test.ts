import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import ProfileEditor from '@/components/dashboard/ProfileEditor.vue';
import type { NostrProfile, StoredKey } from '@/types';

const { fetchProfileMock, saveProfileMock, verifyIdentifierMock, notifyMock } = vi.hoisted(() => ({
  fetchProfileMock: vi.fn(),
  saveProfileMock: vi.fn(),
  verifyIdentifierMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock('@/services/profile-service', () => ({
  profileService: {
    fetchProfile: fetchProfileMock,
    saveProfile: saveProfileMock,
  },
}));

vi.mock('@/services/nip05-service', () => ({
  parseNip05Identifier: (value: string) => {
    const normalized = value.trim();
    const match = normalized.match(/^([^@\s]+)@([^@\s]+)$/);
    if (!match) {
      return null;
    }

    const [, name, domain] = match;
    return { name, domain };
  },
  nip05Service: {
    verifyIdentifier: verifyIdentifierMock,
  },
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({
    notify: notifyMock,
  }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const storedKey: StoredKey = {
  id: 'pubkey-1',
  alias: 'alpha',
  account: {
    privkey: 'privkey-1',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
};

const globalStubs = {
  'q-spinner': true,
  'q-form': {
    template: '<form data-testid="q-form" @submit.prevent="$emit(\'submit\')"><slot /></form>',
    emits: ['submit'],
  },
  'q-input': {
    template:
      '<label data-testid="q-input" :data-label="label"><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><slot name="append" /></label>',
    props: ['modelValue', 'label', 'rules', 'type'],
    emits: ['update:modelValue'],
  },
  'q-toggle': {
    template:
      '<label data-testid="q-toggle" :data-label="label"><input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" /></label>',
    props: ['modelValue', 'label'],
    emits: ['update:modelValue'],
  },
  'q-btn': {
    template:
      '<button data-testid="q-btn" :data-label="label" :disabled="disable" @click="$emit(\'click\')"><slot /></button>',
    props: ['label', 'disable', 'loading', 'type'],
    emits: ['click'],
  },
};

async function flushComponent() {
  await Promise.resolve();
  await nextTick();
}

async function mountEditor(profileData?: NostrProfile) {
  fetchProfileMock.mockResolvedValue(profileData ?? null);

  const wrapper = mount(ProfileEditor, {
    props: {
      storedKey,
    },
    global: {
      stubs: globalStubs,
    },
  });

  await flushComponent();
  return wrapper;
}

describe('ProfileEditor.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveProfileMock.mockResolvedValue(undefined);
    verifyIdentifierMock.mockResolvedValue({ status: 'verified' });
  });

  it('saves bot=true when enabled', async () => {
    const wrapper = await mountEditor();

    const toggleInput = wrapper.find('[data-testid="q-toggle"] input');
    await toggleInput.setValue(true);

    await wrapper.find('form[data-testid="q-form"]').trigger('submit');
    await flushComponent();

    expect(saveProfileMock).toHaveBeenCalledWith(
      storedKey.id,
      expect.objectContaining({
        bot: true,
      }),
    );
  });

  it('serializes partial birthday values as numbers', async () => {
    const wrapper = await mountEditor();
    const birthdayInputs = wrapper.findAll('.profile-editor__birthday-grid input');

    await birthdayInputs[0]!.setValue('1980');
    await birthdayInputs[1]!.setValue('5');

    await wrapper.find('form[data-testid="q-form"]').trigger('submit');
    await flushComponent();

    expect(saveProfileMock).toHaveBeenCalledWith(
      storedKey.id,
      expect.objectContaining({
        birthday: {
          year: 1980,
          month: 5,
        },
      }),
    );
  });

  it('omits birthday when all birthday fields are empty', async () => {
    const wrapper = await mountEditor();

    await wrapper.find('form[data-testid="q-form"]').trigger('submit');
    await flushComponent();

    const savePayload = saveProfileMock.mock.calls[0]?.[1] as NostrProfile | undefined;
    expect(savePayload).toBeDefined();
    expect(savePayload?.birthday).toBeUndefined();
  });

  it('does not auto-run NIP-05 verification on input change', async () => {
    const wrapper = await mountEditor();
    const nip05Input = wrapper.find('[data-testid="q-input"][data-label="profile.nip05"] input');

    await nip05Input.setValue('alice@example.com');
    await flushComponent();

    expect(verifyIdentifierMock).not.toHaveBeenCalled();
  });

  it('keeps verify button disabled for a malformed NIP-05 identifier', async () => {
    const wrapper = await mountEditor();
    const nip05Input = wrapper.find('[data-testid="q-input"][data-label="profile.nip05"] input');

    await nip05Input.setValue('not-a-valid-identifier');
    await flushComponent();

    const verifyBtn = wrapper.find(
      '[data-testid="q-btn"][data-label="profile.nip05VerifyIdentifier"]',
    );
    expect(verifyBtn.attributes('disabled')).toBeDefined();
  });

  it('calls verifyIdentifier when verify button is clicked for a valid identifier', async () => {
    const wrapper = await mountEditor();
    const nip05Input = wrapper.find('[data-testid="q-input"][data-label="profile.nip05"] input');

    await nip05Input.setValue('alice@example.com');
    await flushComponent();

    const verifyBtn = wrapper.find(
      '[data-testid="q-btn"][data-label="profile.nip05VerifyIdentifier"]',
    );
    await verifyBtn.trigger('click');
    await flushPromises();

    expect(verifyIdentifierMock).toHaveBeenCalledWith('alice@example.com', storedKey.id);
  });

  it('renders verified inline status after successful verification', async () => {
    verifyIdentifierMock.mockResolvedValue({
      status: 'verified',
      identifier: 'alice@example.com',
      domain: 'example.com',
      name: 'alice',
    });

    const wrapper = await mountEditor();
    const nip05Input = wrapper.find('[data-testid="q-input"][data-label="profile.nip05"] input');

    await nip05Input.setValue('alice@example.com');
    await flushComponent();

    await wrapper
      .find('[data-testid="q-btn"][data-label="profile.nip05VerifyIdentifier"]')
      .trigger('click');
    await flushPromises();

    const statusBlock = wrapper.find('.profile-identity__nip05-status--success');
    expect(statusBlock.exists()).toBe(true);
    expect(statusBlock.text()).toContain('profile.nip05StatusVerifiedTitle');
  });

  it('discards stale verification result when identifier changes before request resolves', async () => {
    let resolveVerify!: (result: {
      status: string;
      identifier: string;
      domain: string;
      name: string;
    }) => void;
    verifyIdentifierMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveVerify = resolve;
        }),
    );

    const wrapper = await mountEditor();
    const nip05Input = wrapper.find('[data-testid="q-input"][data-label="profile.nip05"] input');

    await nip05Input.setValue('alice@example.com');
    await flushComponent();

    await wrapper
      .find('[data-testid="q-btn"][data-label="profile.nip05VerifyIdentifier"]')
      .trigger('click');
    await flushComponent(); // request is in flight, not yet resolved

    // Change identifier while request is still in flight
    await nip05Input.setValue('bob@example.com');
    await flushComponent();

    // Resolve the stale request for alice
    resolveVerify({
      status: 'verified',
      identifier: 'alice@example.com',
      domain: 'example.com',
      name: 'alice',
    });
    await flushPromises();

    // Stale result must not be applied under bob's identifier. The neutral status is what renders
    // instead; checking for it keeps this from passing against a status block that is not there.
    expect(wrapper.find('.profile-identity__nip05-status--neutral').exists()).toBe(true);
    expect(wrapper.find('.profile-identity__nip05-status--success').exists()).toBe(false);
  });

  it('saves the NIP-05 identifier and Lightning Address with the details, in one publish', async () => {
    const wrapper = await mountEditor({ name: 'alice' });

    await wrapper
      .find('[data-testid="q-input"][data-label="profile.nip05"] input')
      .setValue('alice@example.com');
    await wrapper
      .find('[data-testid="q-input"][data-label="profile.lud16"] input')
      .setValue('alice@getalby.com');
    await wrapper
      .find('[data-testid="q-input"][data-label="profile.displayName"] input')
      .setValue('Alice');

    await wrapper.find('form[data-testid="q-form"]').trigger('submit');
    await flushComponent();

    expect(saveProfileMock).toHaveBeenCalledTimes(1);
    expect(saveProfileMock).toHaveBeenCalledWith(
      storedKey.id,
      expect.objectContaining({
        name: 'alice',
        display_name: 'Alice',
        nip05: 'alice@example.com',
        lud16: 'alice@getalby.com',
      }),
    );
  });

  // The images are published from the header as they are uploaded. Sending the copy loaded with the
  // page would put back an avatar replaced since, so the editor must leave both to the latest (#200).
  it('never sends the picture or banner it loaded', async () => {
    const wrapper = await mountEditor({
      name: 'alice',
      picture: 'https://example.com/old-avatar.png',
      banner: 'https://example.com/old-banner.png',
    });

    await wrapper.find('form[data-testid="q-form"]').trigger('submit');
    await flushComponent();

    const savePayload = saveProfileMock.mock.calls[0]?.[1] as NostrProfile | undefined;
    expect(savePayload).toMatchObject({ name: 'alice' });
    expect(savePayload).not.toHaveProperty('picture');
    expect(savePayload).not.toHaveProperty('banner');
  });

  it('says there are unsaved changes after an edit, and stops saying so once saved', async () => {
    const wrapper = await mountEditor({ name: 'alice' });
    const status = () => wrapper.find('.profile-editor__savebar-status').text();

    expect(status()).toBe('');

    await wrapper
      .find('[data-testid="q-input"][data-label="profile.lud16"] input')
      .setValue('alice@getalby.com');
    expect(status()).toBe('profile.unsavedChanges');

    await wrapper.find('form[data-testid="q-form"]').trigger('submit');
    await flushPromises();
    expect(status()).toBe('');
  });

  it('keeps saying there are unsaved changes when the save fails', async () => {
    saveProfileMock.mockRejectedValue(new Error('no relay accepted it'));
    const wrapper = await mountEditor({ name: 'alice' });

    await wrapper.find('[data-testid="q-input"][data-label="profile.name"] input').setValue('bob');
    await wrapper.find('form[data-testid="q-form"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('.profile-editor__savebar-status').text()).toBe('profile.unsavedChanges');
  });

  it('renders failure inline status for pubkey-mismatch', async () => {
    verifyIdentifierMock.mockResolvedValue({
      status: 'pubkey-mismatch',
      identifier: 'alice@example.com',
    });

    const wrapper = await mountEditor();
    const nip05Input = wrapper.find('[data-testid="q-input"][data-label="profile.nip05"] input');

    await nip05Input.setValue('alice@example.com');
    await flushComponent();

    await wrapper
      .find('[data-testid="q-btn"][data-label="profile.nip05VerifyIdentifier"]')
      .trigger('click');
    await flushPromises();

    const statusBlock = wrapper.find('.profile-identity__nip05-status--failure');
    expect(statusBlock.exists()).toBe(true);
    expect(statusBlock.text()).toContain('profile.nip05StatusFailureTitle');
  });
});
