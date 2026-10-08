import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

/**
 * S17, the setup screen that creates the vault (#198).
 *
 * What is worth covering here is the gate on the submit button. `handleCreate` returns silently
 * when the password is short or the two do not match, so a form that let either through would look
 * to the user like a button that does nothing.
 */

/*
 * The refs cannot be built in `vi.hoisted`: it runs before `vue` is imported, so `ref` is not yet
 * defined there. The holder is hoisted instead, and filled in `beforeEach` — which is soon enough,
 * because `useVault()` is not called until the component mounts.
 */
const holder = vi.hoisted(() => ({ vault: undefined as unknown }));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@/composables/useVault', () => ({
  useVault: () => holder.vault,
}));

import SidebarSetup from '@/components/sidebar/SidebarSetup.vue';

const mountForm = () =>
  mount(SidebarSetup, {
    global: {
      stubs: {
        'q-input': { props: ['modelValue', 'error'], template: '<input :data-error="error" />' },
        /*
         * No explicit `$emit('click')`. A native click on the stub's root already reaches the
         * component's own `@click` through attribute fallthrough, so emitting as well fires each
         * handler twice — which reads as a duplicate-submit bug that is not there.
         */
        'q-btn': {
          props: ['label', 'disable', 'loading'],
          template: '<button :disabled="disable">{{ label }}</button>',
        },
      },
    },
  });

const submitButton = (wrapper: ReturnType<typeof mountForm>) => wrapper.find('button');

let state: {
  password: ReturnType<typeof ref<string>>;
  confirmPassword: ReturnType<typeof ref<string>>;
  loading: ReturnType<typeof ref<boolean>>;
  loginError: ReturnType<typeof ref<string>>;
  handleCreate: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    password: ref(''),
    confirmPassword: ref(''),
    loading: ref(false),
    loginError: ref(''),
    handleCreate: vi.fn(),
  };
  holder.vault = state;
});

describe('SidebarSetup', () => {
  it('refuses to submit an empty form', () => {
    expect(submitButton(mountForm()).attributes('disabled')).toBeDefined();
  });

  it('refuses a password under eight characters', () => {
    state.password.value = 'short';
    state.confirmPassword.value = 'short';

    expect(submitButton(mountForm()).attributes('disabled')).toBeDefined();
  });

  it('refuses two passwords that do not match', () => {
    state.password.value = 'longenough1';
    state.confirmPassword.value = 'longenough2';

    expect(submitButton(mountForm()).attributes('disabled')).toBeDefined();
  });

  it('allows a long enough password that matches', async () => {
    state.password.value = 'longenough1';
    state.confirmPassword.value = 'longenough1';

    const wrapper = mountForm();
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined();

    await submitButton(wrapper).trigger('click');
    expect(state.handleCreate).toHaveBeenCalledTimes(1);
  });

  it('refuses to submit again while a creation is in flight', () => {
    state.password.value = 'longenough1';
    state.confirmPassword.value = 'longenough1';
    state.loading.value = true;

    expect(submitButton(mountForm()).attributes('disabled')).toBeDefined();
  });

  it('offers exactly one action, so there is nowhere to go but forward', () => {
    // The screen it replaced had a Back button to a prompt that no longer exists. A second control
    // here would be a route out of the one thing the user is here to do.
    expect(mountForm().findAll('button')).toHaveLength(1);
  });
});
