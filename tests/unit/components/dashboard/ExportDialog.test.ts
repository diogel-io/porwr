import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import ExportDialog from '@/components/dashboard/ExportDialog.vue';

const stubs = {
  'q-dialog': { template: '<div><slot /></div>' },
  'q-card': { template: '<div><slot /></div>' },
  'q-card-section': { template: '<div><slot /></div>' },
  'q-card-actions': { template: '<div><slot /></div>' },
  'q-separator': true,
  'q-icon': true,
  'q-input': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `<input :data-testid="$attrs['data-testid']" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  'q-btn': {
    props: ['disable', 'label'],
    emits: ['click'],
    template: `<button :data-testid="$attrs['data-testid']" :disabled="disable" @click="$emit('click')">{{ label }}</button>`,
  },
};

const mountDialog = () => mount(ExportDialog, { props: { modelValue: true }, global: { stubs } });

/** The export password protects the key in the file, so it has a minimum and is typed twice (#141). */
describe('ExportDialog', () => {
  it('offers a neutral file name that does not say whose key it is', () => {
    const wrapper = mountDialog();
    const inputs = wrapper.findAll('input');

    expect((inputs.at(-1)!.element as HTMLInputElement).value).toMatch(
      /^porwr-key-backup-\d{4}-\d{2}-\d{2}\.txt$/,
    );
  });

  it.each([
    ['a password under 8 characters', 'short', 'short'],
    ['passwords that do not match', 'long-enough', 'long-enougH'],
  ])('will not export with %s', async (_label, password, confirm) => {
    const wrapper = mountDialog();
    await wrapper.get('[data-testid="export-password"]').setValue(password);
    await wrapper.get('[data-testid="export-password-confirm"]').setValue(confirm);

    await wrapper.get('[data-testid="export-confirm"]').trigger('click');

    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('exports with a long enough password typed the same twice', async () => {
    const wrapper = mountDialog();
    await wrapper.get('[data-testid="export-password"]').setValue('long-enough');
    await wrapper.get('[data-testid="export-password-confirm"]').setValue('long-enough');

    await wrapper.get('[data-testid="export-confirm"]').trigger('click');

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toMatchObject({ password: 'long-enough' });
  });
});
