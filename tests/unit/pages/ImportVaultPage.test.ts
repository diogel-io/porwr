import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The Import vault page explains the import and only replaces the vault with a proven password (#313). */

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

import ImportVaultPage from '@/pages/dashboard/ImportVaultPage.vue';

// Renders the banner's `action` slot too, so a button put there would show up in these tests.
const slotStub = (tag = 'div') => ({ template: `<${tag}><slot /><slot name="action" /></${tag}>` });

const QFileStub = {
  name: 'QFileStub',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<div class="file-stub" />',
};

const mountPage = () =>
  mount(ImportVaultPage, {
    global: {
      stubs: {
        'q-page': slotStub(),
        'q-card': slotStub(),
        'q-card-section': slotStub(),
        'q-banner': slotStub(),
        'q-icon': true,
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
  wrapper.get('[data-testid="vault-import-confirm"]');

describe('ImportVaultPage (#313)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leads back to the Keys list and ends in the page title', () => {
    const crumb = mountPage().get('.crumbs-stub');

    expect(JSON.parse(crumb.attributes('data-items')!)).toEqual([
      { label: 'navigation.keys.label', to: { name: 'keys' } },
      { label: 'keyManagement.vaultImport.title' },
    ]);
  });

  it('says what importing does before anything happens', () => {
    const warning = mountPage().get('[data-testid="vault-import-warning"]').text();

    for (const point of ['replaces', 'erases', 'password', 'exportFirst']) {
      expect(warning).toContain(`keyManagement.vaultImport.${point}`);
    }
  });

  it('advises exporting first without offering an export action of its own (#317)', () => {
    const wrapper = mountPage();
    const warning = wrapper.get('[data-testid="vault-import-warning"]');

    expect(warning.text()).toContain('keyManagement.vaultImport.exportFirst');
    expect(warning.findAll('button, a')).toHaveLength(0);
    expect(wrapper.find('[data-to*="export-vault"]').exists()).toBe(false);
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
    const error = wrapper.get('[data-testid="vault-import-error"]').text();
    expect(error).toContain('keyManagement.vaultImport.errors.wrongPassword');
    expect(error).toContain('keyManagement.vaultImport.unchanged');
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

    expect(wrapper.get('[data-testid="vault-import-error"]').text()).toContain(
      'keyManagement.vaultImport.errors.invalidFile',
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
      expect.objectContaining({ type: 'positive', message: 'keyManagement.vaultImport.success' }),
    );
    expect(testState.push).toHaveBeenCalledWith({ name: 'login' });
  });
});
