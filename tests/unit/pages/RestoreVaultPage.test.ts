import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The Vault Restore page explains the restore and only replaces the vault with a proven password (#313, #392). */

const testState = vi.hoisted(() => ({
  notify: vi.fn(),
  push: vi.fn(async () => undefined),
  importVaultFromFile: vi.fn(),
}));

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: testState.push }) }));
vi.mock('quasar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('quasar')>()),
  useQuasar: () => ({ notify: testState.notify }),
}));
vi.mock('@/composables/useVaultManagement', () => ({
  useVaultManagement: () => ({
    importVaultFromFile: testState.importVaultFromFile,
  }),
}));

import RestoreVaultPage from '@/pages/dashboard/RestoreVaultPage.vue';

// Renders the banner's `action` slot too, so a button put there would show up in these tests.
const slotStub = (tag = 'div') => ({ template: `<${tag}><slot /><slot name="action" /></${tag}>` });

const QFileStub = {
  name: 'QFileStub',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<div class="file-stub" />',
};

const mountPage = () =>
  mount(RestoreVaultPage, {
    global: {
      stubs: {
        'q-page': slotStub(),
        'q-card': slotStub(),
        'q-card-section': slotStub(),
        'q-banner': slotStub(),
        'q-icon': true,
        // Stands in for vue-i18n's global <i18n-t>: shows the keypath and renders the link slot.
        'i18n-t': {
          props: ['keypath', 'tag'],
          template: '<li :data-keypath="keypath">{{ keypath }} <slot name="link" /></li>',
        },
        'dashboard-breadcrumbs': {
          props: ['items'],
          template: '<nav class="crumbs-stub" :data-items="JSON.stringify(items)" />',
        },
        'q-file': QFileStub,
        'q-input': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<input class="password-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        'q-btn': {
          props: ['label', 'disable', 'to'],
          emits: ['click'],
          template:
            '<button v-bind="$attrs" :data-to="JSON.stringify(to)" :disabled="disable" @click="$emit(\'click\')">{{ label }}</button>',
        },
      },
    },
  });

const backup = new File(['{"encryptedData":"v2:abc"}'], 'backup.json');

/** Chooses `backup` and types `password`, as the user would. */
const fillIn = async (wrapper: ReturnType<typeof mountPage>, password = 'pw') => {
  wrapper.getComponent(QFileStub).vm.$emit('update:modelValue', backup);
  await wrapper.get('.password-stub').setValue(password);
};

const confirmButton = (wrapper: ReturnType<typeof mountPage>) =>
  wrapper.get('[data-testid="vault-restore-confirm"]');

describe('RestoreVaultPage (#313, #392)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leads back to the Keys list and ends in the page title', () => {
    const crumb = mountPage().get('.crumbs-stub');

    expect(JSON.parse(crumb.attributes('data-items')!)).toEqual([
      { label: 'navigation.keys.label', to: { name: 'keys' } },
      { label: 'keyManagement.vaultRestore.title' },
    ]);
  });

  it('is headed Important and lists the five points in order', () => {
    const warning = mountPage().get('[data-testid="vault-restore-warning"]');

    expect(warning.text()).toContain('keyManagement.vaultRestore.warningTitle');
    expect(warning.findAll('li').map((item) => item.text())).toEqual([
      'keyManagement.vaultRestore.replaces',
      'keyManagement.vaultRestore.erases',
      'keyManagement.vaultRestore.password',
      'keyManagement.vaultRestore.backupFirst',
      'keyManagement.vaultRestore.docs keyManagement.vaultRestore.docsLink',
    ]);
  });

  it('links "the documentation" to the Porwr docs in a new tab', () => {
    const link = mountPage().get('[data-testid="vault-restore-docs"]');

    expect(link.text()).toBe('keyManagement.vaultRestore.docsLink');
    expect(link.attributes('href')).toBe('https://diogel.io/docs/porwr');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
  });

  it('advises backing up first without offering a backup action of its own (#317)', () => {
    const wrapper = mountPage();
    const warning = wrapper.get('[data-testid="vault-restore-warning"]');

    expect(warning.text()).toContain('keyManagement.vaultRestore.backupFirst');
    expect(warning.findAll('button')).toHaveLength(0);
    // The documentation is the note's only link.
    expect(warning.findAll('a').map((link) => link.attributes('href'))).toEqual([
      'https://diogel.io/docs/porwr',
    ]);
    expect(wrapper.find('[data-to*="backup-vault"]').exists()).toBe(false);
  });

  it('labels the confirm button Restore, and says it is checking while a restore runs', async () => {
    let finish: (value: { success: false; reason: 'wrongPassword' }) => void = () => {};
    testState.importVaultFromFile.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const wrapper = mountPage();
    expect(confirmButton(wrapper).text()).toBe('keyManagement.vaultRestore.confirm');

    await fillIn(wrapper);
    await confirmButton(wrapper).trigger('click');
    expect(confirmButton(wrapper).text()).toBe('keyManagement.vaultRestore.checking');

    finish({ success: false, reason: 'wrongPassword' });
    await flushPromises();
    expect(confirmButton(wrapper).text()).toBe('keyManagement.vaultRestore.confirm');
  });

  it('cannot start until a backup file is chosen and a password entered', async () => {
    const wrapper = mountPage();
    expect(confirmButton(wrapper).attributes('disabled')).toBeDefined();

    wrapper.getComponent(QFileStub).vm.$emit('update:modelValue', backup);
    await flushPromises();
    expect(confirmButton(wrapper).attributes('disabled')).toBeDefined();

    await wrapper.get('.password-stub').setValue('pw');
    expect(confirmButton(wrapper).attributes('disabled')).toBeUndefined();
  });

  it('shows a wrong password in place, clears it, and stays on the page', async () => {
    testState.importVaultFromFile.mockResolvedValue({ success: false, reason: 'wrongPassword' });
    const wrapper = mountPage();
    await fillIn(wrapper, 'wrong');

    await confirmButton(wrapper).trigger('click');
    await flushPromises();

    expect(testState.importVaultFromFile).toHaveBeenCalledWith(backup, 'wrong');
    const error = wrapper.get('[data-testid="vault-restore-error"]').text();
    expect(error).toContain('keyManagement.vaultRestore.errors.wrongPassword');
    expect(error).toContain('keyManagement.vaultRestore.unchanged');
    expect((wrapper.get('.password-stub').element as HTMLInputElement).value).toBe('');
    expect(testState.push).not.toHaveBeenCalled();
    expect(testState.notify).not.toHaveBeenCalled();
  });

  it('shows an invalid file in place', async () => {
    testState.importVaultFromFile.mockResolvedValue({ success: false, reason: 'invalidFile' });
    const wrapper = mountPage();
    await fillIn(wrapper);

    await confirmButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="vault-restore-error"]').text()).toContain(
      'keyManagement.vaultRestore.errors.invalidFile',
    );
    expect(testState.push).not.toHaveBeenCalled();
  });

  it('says what happened and goes to unlock once the vault is replaced', async () => {
    testState.importVaultFromFile.mockResolvedValue({ success: true });
    const wrapper = mountPage();
    await fillIn(wrapper);

    await confirmButton(wrapper).trigger('click');
    await flushPromises();

    expect(testState.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'positive', message: 'keyManagement.vaultRestore.success' }),
    );
    expect(testState.push).toHaveBeenCalledWith({ name: 'login' });
  });
});
