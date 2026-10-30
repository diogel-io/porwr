import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const ALICE = { id: 'a'.repeat(64), alias: 'alice', createdAt: '', account: { privkey: '' } };
const BOB = { id: 'b'.repeat(64), alias: 'bob', createdAt: '', account: { privkey: '' } };

const mocks = vi.hoisted(() => ({
  fetchServerList: vi.fn(),
  publishServerList: vi.fn(),
  notify: vi.fn(),
  dialog: vi.fn(),
  /** What the user does with the "replace your list" dialog. */
  dialogAnswer: 'ok' as 'ok' | 'cancel',
  settings: {
    blossomServer: 'https://vault.example/',
    getSettings: vi.fn(),
  },
  accounts: {
    activeAccountOrFirst: undefined as unknown,
    hasNoAccounts: false,
    activeKey: 'alice' as string | undefined,
    getKeys: vi.fn(),
    setActiveKey: vi.fn(),
  },
}));

vi.mock('@/services/blossom-server-list', async () => {
  const actual = await vi.importActual<typeof import('@/services/blossom-server-list')>(
    '@/services/blossom-server-list',
  );
  return {
    buildServerListTags: actual.buildServerListTags,
    fetchServerList: mocks.fetchServerList,
    publishServerList: mocks.publishServerList,
  };
});

vi.mock('@/stores/settings-store', async () => {
  const { reactive } = await import('vue');
  const store = reactive(mocks.settings);
  return { default: () => store };
});

vi.mock('@/stores/account-store', async () => {
  const { reactive } = await import('vue');
  const store = reactive(mocks.accounts);
  return { default: () => store };
});

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({ notify: mocks.notify, dialog: mocks.dialog }),
}));

import MediaManagementPage from '@/pages/dashboard/MediaManagementPage.vue';
import useAccountStore from '@/stores/account-store';

const mountPage = async () => {
  const wrapper = mount(MediaManagementPage, {
    global: {
      stubs: {
        'q-page': { template: '<div><slot /></div>' },
        'q-card': { template: '<div class="q-card"><slot /></div>' },
        'q-card-section': { template: '<section><slot /></section>' },
        'q-list': { template: '<div><slot /></div>' },
        'q-item': { template: '<div><slot /></div>' },
        'q-item-section': { template: '<div><slot /></div>' },
        'q-item-label': { template: '<span><slot /></span>' },
        'q-banner': { template: '<div class="q-banner"><slot /></div>' },
        'q-spinner': true,
        'q-icon': true,
        'q-input': {
          template:
            '<div :data-loading="loading"><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><span class="error">{{ error ? errorMessage : \'\' }}</span></div>',
          props: ['modelValue', 'error', 'errorMessage', 'loading'],
          emits: ['update:modelValue'],
        },
        'q-btn': {
          template: '<button :disabled="disable" @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label', 'disable', 'loading'],
          emits: ['click'],
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

type Wrapper = Awaited<ReturnType<typeof mountPage>>;

const input = (wrapper: Wrapper) => wrapper.find('input').element as HTMLInputElement;
const saveButton = (wrapper: Wrapper) => wrapper.find('button');
const save = async (wrapper: Wrapper) => {
  await saveButton(wrapper).trigger('click');
  await flushPromises();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.blossomServer = 'https://vault.example/';
  mocks.accounts.activeAccountOrFirst = ALICE;
  mocks.accounts.hasNoAccounts = false;
  mocks.accounts.activeKey = 'alice';
  mocks.fetchServerList.mockResolvedValue({ status: 'not-found' });
  mocks.publishServerList.mockResolvedValue(undefined);
  mocks.dialogAnswer = 'ok';
  mocks.dialog.mockImplementation(() => {
    const dialog = {
      onOk: (callback: () => void) => {
        if (mocks.dialogAnswer === 'ok') callback();
        return dialog;
      },
      onCancel: (callback: () => void) => {
        if (mocks.dialogAnswer === 'cancel') callback();
        return dialog;
      },
    };
    return dialog;
  });
});

describe('MediaManagementPage (porwr#417)', () => {
  it("shows the first server of the active account's kind 10063", async () => {
    mocks.fetchServerList.mockResolvedValue({
      status: 'found',
      servers: ['https://primary.example', 'https://mirror.example'],
    });

    const wrapper = await mountPage();

    expect(mocks.fetchServerList).toHaveBeenCalledWith(ALICE.id);
    expect(input(wrapper).value).toBe('https://primary.example');
    expect(wrapper.find('[data-testid="blossom-server-not-published"]').exists()).toBe(false);
  });

  it('shows the vault default, without its trailing slash, for an account with no list', async () => {
    const wrapper = await mountPage();

    expect(input(wrapper).value).toBe('https://vault.example');
    expect(wrapper.find('[data-testid="blossom-server-not-published"]').exists()).toBe(true);
  });

  it('saves nothing while the user types', async () => {
    const wrapper = await mountPage();

    await wrapper.find('input').setValue('https://media.example.org');
    await flushPromises();

    expect(mocks.publishServerList).not.toHaveBeenCalled();
  });

  it('refuses a URL that ends in a slash, and accepts it without one', async () => {
    const wrapper = await mountPage();

    await wrapper.find('input').setValue('https://threenine.blossom.band/');
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
    expect(wrapper.find('.error').text()).not.toBe('');

    await wrapper.find('input').setValue('https://threenine.blossom.band');
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined();
    expect(wrapper.find('.error').text()).toBe('');
  });

  it.each(['http://media.example.org', 'not a url', 'https://user:pass@media.example.org'])(
    'refuses %s',
    async (value) => {
      const wrapper = await mountPage();

      await wrapper.find('input').setValue(value);
      await save(wrapper);

      expect(mocks.publishServerList).not.toHaveBeenCalled();
    },
  );

  it('publishes the new primary first and keeps the other servers after it', async () => {
    mocks.fetchServerList.mockResolvedValue({
      status: 'found',
      servers: ['https://old.example', 'https://mirror.example', 'https://new.example'],
    });
    const wrapper = await mountPage();

    await wrapper.find('input').setValue('https://new.example');
    await save(wrapper);

    expect(mocks.publishServerList).toHaveBeenCalledWith(ALICE.id, [
      ['server', 'https://new.example'],
      ['server', 'https://old.example'],
      ['server', 'https://mirror.example'],
    ]);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'positive', message: 'mediaManagement.saveSuccess' }),
    );
  });

  it('has nothing to save while the field shows the published primary', async () => {
    mocks.fetchServerList.mockResolvedValue({
      status: 'found',
      servers: ['https://primary.example'],
    });

    const wrapper = await mountPage();

    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
  });

  it('publishes the shown default for an account with no list', async () => {
    const wrapper = await mountPage();

    await save(wrapper);

    expect(mocks.publishServerList).toHaveBeenCalledWith(ALICE.id, [
      ['server', 'https://vault.example'],
    ]);
  });

  it('tells the user when publishing fails', async () => {
    mocks.publishServerList.mockRejectedValue(new Error('no relay accepted it'));
    const wrapper = await mountPage();

    await save(wrapper);

    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'negative', message: 'mediaManagement.saveError' }),
    );
  });

  describe('when the list could not be read', () => {
    beforeEach(() => {
      mocks.fetchServerList.mockResolvedValue({ status: 'unreachable' });
    });

    it('says so, and publishes only the entered server once the user confirms', async () => {
      const wrapper = await mountPage();
      expect(wrapper.find('[data-testid="blossom-server-load-error"]').exists()).toBe(true);

      await wrapper.find('input').setValue('https://new.example');
      await save(wrapper);

      expect(mocks.dialog).toHaveBeenCalledTimes(1);
      expect(mocks.publishServerList).toHaveBeenCalledWith(ALICE.id, [
        ['server', 'https://new.example'],
      ]);
    });

    it('publishes nothing when another account is chosen while the dialog is open', async () => {
      let answer: () => void = () => {};
      mocks.dialog.mockImplementation(() => {
        const dialog = {
          onOk: (callback: () => void) => {
            answer = callback;
            return dialog;
          },
          onCancel: () => dialog,
        };
        return dialog;
      });
      const wrapper = await mountPage();

      await saveButton(wrapper).trigger('click');
      (useAccountStore() as unknown as typeof mocks.accounts).activeAccountOrFirst = BOB;
      await flushPromises();
      answer();
      await flushPromises();

      expect(mocks.publishServerList).not.toHaveBeenCalled();
    });

    it('publishes nothing when the user cancels', async () => {
      mocks.dialogAnswer = 'cancel';
      const wrapper = await mountPage();

      await save(wrapper);

      expect(mocks.publishServerList).not.toHaveBeenCalled();
    });
  });

  it('reloads the field when another account is chosen', async () => {
    mocks.fetchServerList.mockImplementation((pubkey: string) =>
      Promise.resolve(
        pubkey === BOB.id
          ? { status: 'found', servers: ['https://bob.example'] }
          : { status: 'found', servers: ['https://alice.example'] },
      ),
    );
    const wrapper = await mountPage();
    expect(input(wrapper).value).toBe('https://alice.example');

    // A getter in the real store; the mock's reactive copy stands in for the switch.
    (useAccountStore() as unknown as typeof mocks.accounts).activeAccountOrFirst = BOB;
    await flushPromises();

    expect(mocks.fetchServerList).toHaveBeenLastCalledWith(BOB.id);
    expect(input(wrapper).value).toBe('https://bob.example');
  });

  it('does not show a save that finishes after another account was chosen', async () => {
    let finishPublish: () => void = () => {};
    mocks.publishServerList.mockImplementation(
      () => new Promise<void>((resolve) => (finishPublish = resolve)),
    );
    mocks.fetchServerList.mockImplementation((pubkey: string) =>
      Promise.resolve(
        pubkey === BOB.id
          ? { status: 'found', servers: ['https://bob.example'] }
          : { status: 'not-found' },
      ),
    );
    const wrapper = await mountPage();
    await wrapper.find('input').setValue('https://alice.example');
    await saveButton(wrapper).trigger('click');

    (useAccountStore() as unknown as typeof mocks.accounts).activeAccountOrFirst = BOB;
    await flushPromises();
    finishPublish();
    await flushPromises();

    expect(input(wrapper).value).toBe('https://bob.example');
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
  });

  it('loads the list of an account that appears after the page opened', async () => {
    mocks.accounts.activeAccountOrFirst = undefined;
    mocks.accounts.hasNoAccounts = true;
    mocks.fetchServerList.mockResolvedValue({
      status: 'found',
      servers: ['https://alice.example'],
    });
    const wrapper = await mountPage();

    const store = useAccountStore() as unknown as typeof mocks.accounts;
    store.hasNoAccounts = false;
    store.activeAccountOrFirst = ALICE;
    await flushPromises();

    expect(mocks.fetchServerList).toHaveBeenCalledWith(ALICE.id);
    expect(input(wrapper).value).toBe('https://alice.example');
  });

  it('treats a failed load as unreachable, so the page stays usable', async () => {
    mocks.fetchServerList.mockRejectedValue(new Error('relay pool failed'));

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="blossom-server-load-error"]').exists()).toBe(true);
    expect(input(wrapper).value).toBe('https://vault.example');
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined();
  });

  it('asks for an account when the vault has none', async () => {
    mocks.accounts.activeAccountOrFirst = undefined;
    mocks.accounts.hasNoAccounts = true;

    const wrapper = await mountPage();

    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.text()).toContain('account.noAccounts');
    expect(mocks.fetchServerList).not.toHaveBeenCalled();
  });
});

describe('MediaManagementPage loading state (porwr#420)', () => {
  const field = (wrapper: Wrapper) => wrapper.find('[data-loading]');

  it('shows a spinner and no validation error while the list loads', async () => {
    let finishLoad: (lookup: unknown) => void = () => {};
    mocks.fetchServerList.mockReturnValue(
      new Promise((resolve) => {
        finishLoad = resolve;
      }),
    );

    const wrapper = await mountPage();

    expect(input(wrapper).value).toBe('');
    expect(field(wrapper).attributes('data-loading')).toBe('true');
    expect(wrapper.find('.error').text()).toBe('');
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();

    finishLoad({ status: 'found', servers: ['https://primary.example'] });
    await flushPromises();

    expect(field(wrapper).attributes('data-loading')).toBe('false');
    expect(input(wrapper).value).toBe('https://primary.example');
  });

  it('stops the spinner and shows the default when the account has no list', async () => {
    const wrapper = await mountPage();

    expect(field(wrapper).attributes('data-loading')).toBe('false');
    expect(input(wrapper).value).toBe('https://vault.example');
    expect(wrapper.find('[data-testid="blossom-server-not-published"]').exists()).toBe(true);
  });

  it.each(['', 'not a url', 'https://threenine.blossom.band/'])(
    'still shows the validation error for %j once loaded',
    async (value) => {
      const wrapper = await mountPage();

      await wrapper.find('input').setValue(value);

      expect(wrapper.find('.error').text()).not.toBe('');
      expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
    },
  );

  it('explains the Blossom server list below the field', async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="blossom-server-help"]').text()).toBe(
      'mediaManagement.serverListHelp',
    );
  });
});
