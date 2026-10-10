import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import ImportKeyForm from '@/components/dashboard/key-management/ImportKeyForm.vue';

const { saveKeyMock, pushMock, notifyMock } = vi.hoisted(() => ({
  saveKeyMock: vi.fn(),
  pushMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock('@/stores/account-store', () => ({
  default: () => ({
    saveKey: saveKeyMock,
  }),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({
    notify: notifyMock,
  }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'account.mainAccountReserved') {
        return 'Main Account';
      }

      if (key === 'account.mainAccountReservedError') {
        return `Alias "${params?.name ?? ''}" is reserved.`;
      }

      return key;
    },
  }),
}));

vi.mock('nostr-tools/nip19', () => ({
  decode: (value: string) => {
    if (value === 'valid-nsec') {
      return {
        type: 'nsec',
        data: new Uint8Array(32).fill(7),
      };
    }

    throw new Error('invalid nsec');
  },
}));

vi.mock('nostr-tools', () => ({
  getPublicKey: vi.fn(() => 'pubkey-hex'),
}));

vi.mock('@noble/hashes/utils', () => ({
  bytesToHex: vi.fn(() => 'privkey-hex'),
}));

const globalStubs = {
  'q-input': {
    template:
      '<label data-testid="q-input" :data-label="label"><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><slot name="prepend" /><slot name="append" /></label>',
    props: ['modelValue', 'label', 'rules'],
    emits: ['update:modelValue'],
  },
  'q-btn': {
    template:
      '<button data-testid="q-btn" :data-label="label" :disabled="disable" @click="$emit(\'click\')"><slot /></button>',
    props: ['label', 'disable'],
    emits: ['click'],
  },
  'q-icon': {
    template: '<i><slot /></i>',
    props: ['name'],
  },
  'q-tooltip': {
    template: '<span><slot /></span>',
  },
  'view-stored-key': {
    template: '<div data-testid="view-stored-key" />',
    props: ['storedKey'],
  },
};

async function flushComponent(): Promise<void> {
  await Promise.resolve();
  await nextTick();
}

function requiredInput(wrapper: ReturnType<typeof mount>, index: number) {
  const input = wrapper.findAll('input')[index];
  expect(input).toBeDefined();

  return input!;
}

describe('ImportKeyForm.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The background answers with the new account's summary (#240).
    saveKeyMock.mockImplementation((request: { alias: string }) =>
      Promise.resolve({ id: 'pubkey-hex', alias: request.alias, createdAt: '2026-05-01T00:00:00.000Z' }),
    );
    pushMock.mockResolvedValue(undefined);
  });

  it('rejects invalid nsec and does not show preview', async () => {
    const wrapper = mount(ImportKeyForm, {
      global: {
        stubs: globalStubs,
      },
    });

    const nsecInput = requiredInput(wrapper, 0);
    await nsecInput.setValue('not-an-nsec');
    await wrapper.find('button[data-label="createAccount.importButton"]').trigger('click');

    await flushComponent();

    expect(wrapper.find('[data-testid="view-stored-key"]').exists()).toBe(false);
    expect(saveKeyMock).not.toHaveBeenCalled();
  });

  it('shows preview for valid nsec and requires alias before save', async () => {
    const wrapper = mount(ImportKeyForm, {
      global: {
        stubs: globalStubs,
      },
    });

    const nsecInput = requiredInput(wrapper, 0);
    await nsecInput.setValue('valid-nsec');
    await wrapper.find('button[data-label="createAccount.importButton"]').trigger('click');
    await flushComponent();

    expect(wrapper.find('[data-testid="view-stored-key"]').exists()).toBe(true);

    await wrapper.find('button[data-label="createAccount.save"]').trigger('click');

    expect(saveKeyMock).not.toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'validation.profileNameRequired', type: 'negative' }),
    );
  });

  it('surfaces duplicate alias/key errors from save', async () => {
    saveKeyMock.mockRejectedValueOnce(new Error('Duplicate alias'));

    const wrapper = mount(ImportKeyForm, {
      global: {
        stubs: globalStubs,
      },
    });

    const nsecInput = requiredInput(wrapper, 0);
    await nsecInput.setValue('valid-nsec');
    await wrapper.find('button[data-label="createAccount.importButton"]').trigger('click');
    await flushComponent();

    const aliasInput = requiredInput(wrapper, 1);
    await aliasInput.setValue('alice');
    await wrapper.find('button[data-label="createAccount.save"]').trigger('click');
    await flushComponent();

    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Duplicate alias', type: 'negative' }),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('saves imported key and navigates to the view key page', async () => {
    const wrapper = mount(ImportKeyForm, {
      global: {
        stubs: globalStubs,
      },
    });

    const nsecInput = requiredInput(wrapper, 0);
    await nsecInput.setValue('valid-nsec');
    await wrapper.find('button[data-label="createAccount.importButton"]').trigger('click');
    await flushComponent();

    const aliasInput = requiredInput(wrapper, 1);
    await aliasInput.setValue('  alice  ');
    await wrapper.find('button[data-label="createAccount.save"]').trigger('click');
    await flushComponent();

    // The pasted key goes into the background once, with the alias; nothing comes back with it (#240).
    expect(saveKeyMock).toHaveBeenCalledWith({ alias: 'alice', privkey: 'privkey-hex' });
    expect(pushMock).toHaveBeenCalledWith({ name: 'view-key', params: { alias: 'alice' } });
  });
});
