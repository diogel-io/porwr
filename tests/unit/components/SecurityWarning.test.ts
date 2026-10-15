import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import SecurityWarning from '@/components/dashboard/SecurityWarning.vue';

/**
 * The key-safety warning as a corner icon (#298): the content opens on hover and on focus, Escape
 * closes it, and screen readers get it without either.
 */
const mountWarning = (props: { title: string; message: string; icon?: string }) =>
  mount(SecurityWarning, {
    props,
    global: {
      stubs: {
        'q-btn': {
          template:
            '<button class="q-btn-stub" :data-icon="icon" :data-color="color" @focus="$emit(\'focus\')" @blur="$emit(\'blur\')" @keydown="$emit(\'keydown\', $event)"><slot /></button>',
          props: ['icon', 'color'],
          emits: ['focus', 'blur', 'keydown'],
        },
        'q-tooltip': {
          template: '<div class="q-tooltip-stub" :data-open="String(modelValue)"><slot /></div>',
          props: ['modelValue'],
        },
      },
    },
  });

describe('SecurityWarning.vue', () => {
  it('is a yellow warning icon button named by the title', () => {
    const wrapper = mountWarning({ title: 'Security Warning', message: 'Never share your nsec.' });
    const button = wrapper.find('button');

    expect(button.classes()).toContain('security-warning');
    expect(button.attributes('aria-label')).toBe('Security Warning');
    expect(button.attributes('data-icon')).toBe('warning_amber');
    expect(button.attributes('data-color')).toBe('warning');
  });

  it('describes itself to screen readers without needing the tooltip', () => {
    const wrapper = mountWarning({ title: 'Security Warning', message: 'Never share your nsec.' });
    const describedBy = wrapper.find('button').attributes('aria-describedby');

    expect(describedBy).toBeTruthy();
    const description = wrapper.find(`#${describedBy}`);
    expect(description.text()).toContain('Security Warning');
    expect(description.text()).toContain('Never share your nsec.');
  });

  it('shows the title and message in its panel', () => {
    const wrapper = mountWarning({ title: 'Important', message: 'Export your keys.' });

    expect(wrapper.find('.q-tooltip-stub .security-warning__title').text()).toBe('Important');
    expect(wrapper.find('.q-tooltip-stub .security-warning__message').text()).toBe('Export your keys.');
  });

  it('opens on keyboard focus and closes on blur or Escape, leaving hover to the tooltip', async () => {
    const wrapper = mountWarning({ title: 'Important', message: 'Export your keys.' });
    const panel = () => wrapper.find('.q-tooltip-stub').attributes('data-open');

    // `null` leaves the tooltip to its own hover handling.
    expect(panel()).toBe('null');

    await wrapper.find('button').trigger('focus');
    expect(panel()).toBe('true');

    await wrapper.find('button').trigger('keydown', { key: 'Escape' });
    expect(panel()).toBe('null');

    await wrapper.find('button').trigger('focus');
    await wrapper.find('button').trigger('blur');
    expect(panel()).toBe('null');
  });

  it('gives each warning on a page its own description id', () => {
    const page = mount(
      defineComponent({
        components: { SecurityWarning },
        template: '<div><SecurityWarning title="A" message="a" /><SecurityWarning title="B" message="b" /></div>',
      }),
      { global: { stubs: { 'q-btn': { template: '<button><slot /></button>' }, 'q-tooltip': true } } },
    );
    const ids = page.findAll('button').map((button) => button.attributes('aria-describedby'));

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('still accepts a custom icon', () => {
    const wrapper = mountWarning({ title: 'Title', message: 'Message', icon: 'info' });

    expect(wrapper.find('button').attributes('data-icon')).toBe('info');
  });
});
