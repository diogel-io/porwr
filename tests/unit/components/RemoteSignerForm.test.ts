import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

/**
 * Connecting a remote signer from the Add New Key page (diogel-io/workspace#138).
 *
 * The e2e test covers the successful connection against a real `nak bunker`. These cover the form's
 * own behaviour around it: validation, the authorisation challenges it shows while connecting,
 * clean-up after a failure, and a connection that finishes after the user has left.
 */

const { connectRemoteSigner, push, notify, sendBexMessage } = vi.hoisted(() => ({
  connectRemoteSigner: vi.fn(),
  push: vi.fn(),
  notify: vi.fn(),
  sendBexMessage: vi.fn(),
}));

vi.mock('@/stores/account-store', () => ({ default: () => ({ connectRemoteSigner }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('quasar', () => ({ useQuasar: () => ({ notify }) }));
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${Object.values(values).join(' ')}` : key,
  }),
}));
vi.mock('@/services/bridge-client', () => ({ sendBexMessage }));

import RemoteSignerForm from '@/components/dashboard/key-management/RemoteSignerForm.vue';

const URI = `bunker://${'ab'.repeat(32)}?relay=wss://relay.example.com`;

const stubs = {
  'q-input': {
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ['modelValue', 'label', 'hint', 'disable'],
    emits: ['update:modelValue'],
  },
  'q-btn': {
    template: '<button :disabled="disable" @click="$emit(\'click\')">{{ label }}</button>',
    props: ['label', 'disable', 'loading'],
    emits: ['click'],
  },
  'q-banner': {
    template: '<div class="banner"><slot /><slot name="action" /></div>',
  },
};

const mountForm = () => mount(RemoteSignerForm, { global: { stubs } });

const fill = async (wrapper: ReturnType<typeof mountForm>, uri: string, alias: string) => {
  await wrapper.get('[data-testid="remote-signer-uri"]').setValue(uri);
  await wrapper.get('[data-testid="remote-signer-alias"]').setValue(alias);
};

/** A connection that stays open until the test settles it. */
const pendingConnection = () => {
  let settle!: { resolve: (value: unknown) => void; reject: (error: Error) => void };
  connectRemoteSigner.mockReturnValue(
    new Promise((resolve, reject) => {
      settle = { resolve, reject };
    }),
  );
  return () => settle;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  sendBexMessage.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RemoteSignerForm (#138)', () => {
  it('asks for a name before connecting, and contacts nothing', async () => {
    const wrapper = mountForm();
    await fill(wrapper, URI, '  ');

    await wrapper.get('[data-testid="remote-signer-connect"]').trigger('click');

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
    expect(connectRemoteSigner).not.toHaveBeenCalled();
  });

  it('offers to connect only a bunker:// URI', async () => {
    const wrapper = mountForm();
    await fill(wrapper, 'nostrconnect://abc', 'phone');

    expect(
      wrapper.get('[data-testid="remote-signer-connect"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-testid="remote-signer-connect"]').trigger('click');
    expect(connectRemoteSigner).not.toHaveBeenCalled();
  });

  it('connects, clears the URI, and opens the new key', async () => {
    connectRemoteSigner.mockResolvedValue({ id: 'a'.repeat(64), alias: 'phone', createdAt: '' });
    const wrapper = mountForm();
    await fill(wrapper, ` ${URI} `, ' phone ');

    await wrapper.get('[data-testid="remote-signer-connect"]').trigger('click');
    await flushPromises();

    expect(connectRemoteSigner).toHaveBeenCalledWith({ alias: 'phone', bunkerUri: URI });
    expect(push).toHaveBeenCalledWith({ name: 'view-key', params: { alias: 'phone' } });
    expect(
      (wrapper.get('[data-testid="remote-signer-uri"]').element as HTMLInputElement).value,
    ).toBe('');
  });

  it('shows only the challenges of a connection, not a site’s, while connecting', async () => {
    const settle = pendingConnection();
    sendBexMessage.mockResolvedValue([
      {
        id: 'c1',
        origin: '',
        accountPubkey: '',
        url: 'https://signer.example/a',
        host: 'signer.example',
      },
      {
        id: 'c2',
        origin: 'https://site.example',
        accountPubkey: 'x',
        url: 'https://other.example/b',
        host: 'other.example',
      },
    ]);
    const wrapper = mountForm();
    await fill(wrapper, URI, 'phone');

    await wrapper.get('[data-testid="remote-signer-connect"]').trigger('click');
    await vi.advanceTimersByTimeAsync(1000);

    const banners = wrapper.findAll('[data-testid="remote-signer-form-auth"]');
    expect(banners).toHaveLength(1);
    expect(banners[0]!.text()).toContain('https://signer.example/a');

    settle().resolve({ id: 'a'.repeat(64), alias: 'phone', createdAt: '' });
    await flushPromises();
  });

  it('stops asking about challenges and says why after a failed connection', async () => {
    const settle = pendingConnection();
    const wrapper = mountForm();
    await fill(wrapper, URI, 'phone');

    await wrapper.get('[data-testid="remote-signer-connect"]').trigger('click');
    await vi.advanceTimersByTimeAsync(1000);
    settle().reject(new Error('The remote signer did not answer in time'));
    await flushPromises();

    expect(notify).toHaveBeenCalledWith({
      type: 'negative',
      message: 'keyManagement.remoteSigner.failed The remote signer did not answer in time',
    });
    const reads = sendBexMessage.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(sendBexMessage.mock.calls.length).toBe(reads);
    expect(wrapper.findAll('[data-testid="remote-signer-form-auth"]')).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('does not take the user to the key when they left before it connected', async () => {
    const settle = pendingConnection();
    const wrapper = mountForm();
    await fill(wrapper, URI, 'phone');

    await wrapper.get('[data-testid="remote-signer-connect"]').trigger('click');
    wrapper.unmount();
    settle().resolve({ id: 'a'.repeat(64), alias: 'phone', createdAt: '' });
    await flushPromises();

    expect(push).not.toHaveBeenCalled();
  });

  it('says so when a challenge could not be opened', async () => {
    const settle = pendingConnection();
    sendBexMessage.mockImplementation((action: string) =>
      action === 'nip46.authChallenges'
        ? Promise.resolve([
            {
              id: 'c1',
              origin: '',
              accountPubkey: '',
              url: 'https://signer.example/a',
              host: 'signer.example',
            },
          ])
        : Promise.resolve({ success: false, error: 'ended' }),
    );
    const wrapper = mountForm();
    await fill(wrapper, URI, 'phone');
    await wrapper.get('[data-testid="remote-signer-connect"]').trigger('click');
    await vi.advanceTimersByTimeAsync(1000);

    await wrapper.get('[data-testid="remote-signer-form-auth"] button').trigger('click');
    await flushPromises();

    expect(sendBexMessage).toHaveBeenCalledWith('nip46.openAuthChallenge', { challengeId: 'c1' });
    expect(notify).toHaveBeenCalledWith({
      type: 'negative',
      message: 'sidebar.remoteSignerAuth.openFailed',
    });

    settle().resolve({ id: 'a'.repeat(64), alias: 'phone', createdAt: '' });
    await flushPromises();
  });
});
