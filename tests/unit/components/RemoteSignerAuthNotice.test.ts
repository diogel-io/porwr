import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${Object.values(values).join(' ')}` : key,
  }),
}));

const { sendBexMessage, notify } = vi.hoisted(() => ({ sendBexMessage: vi.fn(), notify: vi.fn() }));
vi.mock('@/services/bridge-client', () => ({ sendBexMessage }));
vi.mock('quasar', () => ({ useQuasar: () => ({ notify }) }));

import RemoteSignerAuthNotice from '@/components/sidebar/RemoteSignerAuthNotice.vue';

const challenge = {
  id: 'nip46-auth-1',
  origin: 'https://site.example',
  accountPubkey: 'a'.repeat(64),
  url: 'https://signer.example/authorise?token=1',
  host: 'signer.example',
};

const mountNotice = (challenges = [challenge]) =>
  mount(RemoteSignerAuthNotice, {
    props: { challenges },
    global: {
      stubs: {
        'q-banner': { template: '<div class="banner"><slot /><slot name="action" /></div>' },
        'q-btn': {
          template: '<button @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label'],
          emits: ['click'],
        },
      },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  sendBexMessage.mockResolvedValue(true);
});

/** A remote signer's `auth_url`, shown on the panel as text and opened only on a click (#138, D13). */
describe('the remote-signer authorisation notice', () => {
  it('shows the waiting site, the URL and its host as text, and loads nothing', () => {
    const wrapper = mountNotice();

    expect(wrapper.text()).toContain('https://site.example');
    expect(wrapper.text()).toContain(challenge.url);
    expect(wrapper.text()).toContain('signer.example');
    // Nothing remote: no image, frame or link that the browser would fetch or follow on its own.
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.find('a[href]').exists()).toBe(false);
    expect(sendBexMessage).not.toHaveBeenCalled();
  });

  it('asks the background to open the challenge by id when clicked', async () => {
    const wrapper = mountNotice();

    await wrapper.find('button').trigger('click');

    expect(sendBexMessage).toHaveBeenCalledWith('nip46.openAuthChallenge', {
      challengeId: 'nip46-auth-1',
    });
    await vi.waitFor(() => expect(sendBexMessage).toHaveBeenCalled());
    expect(notify).not.toHaveBeenCalled();
  });

  it('tells the user when the challenge has ended or could not be opened', async () => {
    sendBexMessage.mockResolvedValueOnce({ success: false, error: 'ended' });
    sendBexMessage.mockRejectedValueOnce(new Error('bridge down'));
    const wrapper = mountNotice();

    await wrapper.find('button').trigger('click');
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    await wrapper.find('button').trigger('click');
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
    expect(notify).toHaveBeenCalledWith({
      type: 'negative',
      message: 'sidebar.remoteSignerAuth.openFailed',
    });
  });

  it('says an account is being connected when no site is waiting', () => {
    const wrapper = mountNotice([{ ...challenge, origin: '' }]);

    expect(wrapper.text()).toContain('sidebar.remoteSignerAuth.forConnect');
  });
});
