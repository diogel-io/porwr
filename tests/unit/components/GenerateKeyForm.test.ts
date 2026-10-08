import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import GenerateKeyForm from '@/components/dashboard/key-management/GenerateKeyForm.vue';

const { saveKeyMock, pushMock, notifyMock, generateKeyMock } = vi.hoisted(() => ({
  saveKeyMock: vi.fn(),
  pushMock: vi.fn(),
  notifyMock: vi.fn(),
  generateKeyMock: vi.fn(),
}));

vi.mock('@/stores/account-store', () => ({
  default: () => ({
    saveKey: saveKeyMock,
  }),
}));

vi.mock('@/services/generate-key', () => ({
  generateKey: generateKeyMock,
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
  'q-list': {
    template: '<div><slot /></div>',
  },
  'q-item': {
    template: '<div><slot /></div>',
  },
  'q-item-section': {
    template: '<div><slot /></div>',
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

function requiredInput(wrapper: ReturnType<typeof mount>) {
  const input = wrapper.find('input');
  expect(input.exists()).toBe(true);

  return input;
}

describe('GenerateKeyForm.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveKeyMock.mockResolvedValue(undefined);
    pushMock.mockResolvedValue(undefined);
    generateKeyMock.mockReturnValue({
      id: 'pubkey-hex',
      alias: '',
      createdAt: '2026-05-01T00:00:00.000Z',
      account: {
        privkey: 'privkey-hex',
      },
    });
  });

  it('generates a new key preview after clicking generate', async () => {
    const wrapper = mount(GenerateKeyForm, {
      global: {
        stubs: globalStubs,
      },
    });

    expect(wrapper.find('[data-testid="view-stored-key"]').exists()).toBe(false);

    await wrapper.find('button[data-label="createAccount.generateKeys"]').trigger('click');
    await flushComponent();

    expect(generateKeyMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="view-stored-key"]').exists()).toBe(true);
  });

  it('requires alias before saving generated key', async () => {
    const wrapper = mount(GenerateKeyForm, {
      global: {
        stubs: globalStubs,
      },
    });

    await wrapper.find('button[data-label="createAccount.generateKeys"]').trigger('click');
    await wrapper.find('button[data-label="createAccount.save"]').trigger('click');

    expect(saveKeyMock).not.toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'validation.profileNameRequired', type: 'negative' }),
    );
  });

  it('rejects reserved alias and does not save', async () => {
    const wrapper = mount(GenerateKeyForm, {
      global: {
        stubs: globalStubs,
      },
    });

    await wrapper.find('button[data-label="createAccount.generateKeys"]').trigger('click');
    await requiredInput(wrapper).setValue(' Main Account ');
    await wrapper.find('button[data-label="createAccount.save"]').trigger('click');
    await flushComponent();

    expect(saveKeyMock).not.toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Alias "Main Account" is reserved.', type: 'negative' }),
    );
  });

  it('surfaces duplicate alias/key errors from save', async () => {
    saveKeyMock.mockRejectedValueOnce(new Error('Duplicate alias'));

    const wrapper = mount(GenerateKeyForm, {
      global: {
        stubs: globalStubs,
      },
    });

    await wrapper.find('button[data-label="createAccount.generateKeys"]').trigger('click');
    await requiredInput(wrapper).setValue('alice');
    await wrapper.find('button[data-label="createAccount.save"]').trigger('click');
    await flushComponent();

    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Duplicate alias', type: 'negative' }),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('saves generated key and navigates to the view key page', async () => {
    const wrapper = mount(GenerateKeyForm, {
      global: {
        stubs: globalStubs,
      },
    });

    await wrapper.find('button[data-label="createAccount.generateKeys"]').trigger('click');
    await requiredInput(wrapper).setValue('  alice  ');
    await wrapper.find('button[data-label="createAccount.save"]').trigger('click');
    await flushComponent();

    expect(saveKeyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        alias: 'alice',
        id: 'pubkey-hex',
        account: expect.objectContaining({
          privkey: 'privkey-hex',
        }),
      }),
    );
    expect(pushMock).toHaveBeenCalledWith({ name: 'view-key', params: { alias: 'alice' } });
  });

  it('keeps inner spaces in the profile name while trimming the ends (#230)', async () => {
    const wrapper = mount(GenerateKeyForm, {
      global: {
        stubs: globalStubs,
      },
    });

    await wrapper.find('button[data-label="createAccount.generateKeys"]').trigger('click');
    await requiredInput(wrapper).setValue('  Anne Mous  ');
    await wrapper.find('button[data-label="createAccount.save"]').trigger('click');
    await flushComponent();

    expect(saveKeyMock).toHaveBeenCalledWith(expect.objectContaining({ alias: 'Anne Mous' }));
    expect(pushMock).toHaveBeenCalledWith({ name: 'view-key', params: { alias: 'Anne Mous' } });
  });
});
