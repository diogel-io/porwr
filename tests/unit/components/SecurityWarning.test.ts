import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SecurityWarning from '@/components/dashboard/SecurityWarning.vue';

describe('SecurityWarning.vue', () => {
  it('renders title and message correctly', () => {
    const title = 'Test Title';
    const message = 'Test Message';
    const wrapper = mount(SecurityWarning, {
      props: {
        title,
        message,
      },
      global: {
        stubs: {
          'q-icon': true,
        },
      },
    });

    expect(wrapper.find('.security-warning__title').text()).toBe(title);
    expect(wrapper.find('.security-warning__message').text()).toBe(message);
    expect(wrapper.find('.security-warning').attributes('aria-label')).toBe(title);
    expect(wrapper.find('.security-warning__icon').attributes('name')).toBe('warning_amber');
  });

  it('renders custom icon when provided', () => {
    const customIcon = 'info';
    const wrapper = mount(SecurityWarning, {
      props: {
        title: 'Title',
        message: 'Message',
        icon: customIcon,
      },
      global: {
        stubs: {
          'q-icon': true,
        },
      },
    });

    expect(wrapper.find('.security-warning__icon').attributes('name')).toBe(customIcon);
  });
});
