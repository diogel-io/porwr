import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';

const mocks = vi.hoisted(() => ({
  listNip47Connections: vi.fn(),
  listNip47PaymentHistory: vi.fn(),
  importNip47Connection: vi.fn(),
  getNip47Info: vi.fn(),
  connect: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('@/services/nip47-service', () => ({
  getNip47Balance: vi.fn(),
  getNip47Info: mocks.getNip47Info,
  importNip47Connection: mocks.importNip47Connection,
  listNip47Connections: mocks.listNip47Connections,
  listNip47PaymentHistory: mocks.listNip47PaymentHistory,
  payNip47Invoice: vi.fn(),
  removeNip47Connection: vi.fn(),
  setActiveNip47Connection: vi.fn(),
}));

// The page connects through a separate window (workspace#76); that window is tested on its own.
vi.mock('@/composables/useWalletConnectWindow', () => ({
  useWalletConnectWindow: () => ({ connecting: ref(null), connect: mocks.connect }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({ notify: mocks.notify, dialog: vi.fn() }),
}));

interface FakeAccountStore {
  activeAccount: { id: string; alias: string; createdAt: string } | undefined;
  getKeys: () => Promise<void>;
}

// Reactive, so switching account in a test reaches the page's watcher as the real store would.
vi.mock('@/stores/account-store', async () => {
  const { reactive } = await import('vue');
  const store = reactive<FakeAccountStore>({
    activeAccount: undefined,
    getKeys: () => Promise.resolve(),
  });
  (globalThis as { __walletAccountStore?: FakeAccountStore }).__walletAccountStore = store;
  return { default: () => store };
});

const accountStore = (): FakeAccountStore =>
  (globalThis as { __walletAccountStore?: FakeAccountStore }).__walletAccountStore!;

const ALICE = { id: 'a'.repeat(64), alias: 'alice', createdAt: '2026-01-01' };
const BOB = { id: 'b'.repeat(64), alias: 'bob', createdAt: '2026-01-02' };

import WalletConnectionsPage from '@/pages/dashboard/WalletConnectionsPage.vue';

const VALID_URI = `nostr+walletconnect://${'b'.repeat(64)}?relay=wss%3A%2F%2Frelay.example.com&secret=${'1'.repeat(64)}`;

const slot = (tag = 'div') => ({ template: `<${tag}><slot /></${tag}>` });

const mountPage = async () => {
  const wrapper = mount(WalletConnectionsPage, {
    global: {
      mocks: {
        $t: (key: string, params?: Record<string, string>) =>
          params ? `${key}:${Object.values(params).join(',')}` : key,
      },
      stubs: {
        'q-page': slot(),
        'q-card': slot(),
        'q-card-section': slot('section'),
        'q-card-actions': slot(),
        'q-slide-transition': slot(),
        'q-list': slot(),
        'q-item': slot(),
        'q-item-section': slot(),
        'q-item-label': slot(),
        'q-avatar': slot(),
        'q-badge': slot('span'),
        'q-banner': slot(),
        'q-dialog': true,
        'q-icon': true,
        'q-separator': true,
        'q-checkbox': true,
        'q-btn': {
          template: '<button :disabled="disable" @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label', 'loading', 'disable'],
          emits: ['click'],
        },
        'q-input': {
          template:
            '<label><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><span v-if="error" class="error">{{ errorMessage }}</span></label>',
          props: ['modelValue', 'error', 'errorMessage', 'label'],
        },
        'q-toggle': {
          template:
            '<input type="checkbox" class="toggle" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
          props: ['modelValue'],
        },
        'q-expansion-item': {
          template: '<div class="expansion" :data-open="String(modelValue)"><slot /></div>',
          props: ['modelValue'],
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

// The page watches the account store; a page left mounted from an earlier test would react to the
// next test's account and call the service on its behalf.
enableAutoUnmount(afterEach);

beforeEach(() => {
  accountStore().activeAccount = ALICE;
  vi.clearAllMocks();
  mocks.listNip47Connections.mockResolvedValue([]);
  mocks.listNip47PaymentHistory.mockResolvedValue([]);
});

describe('the wallet connections page (#110)', () => {
  it('offers to connect each supported wallet', async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="connect-alby-hub"]').text()).toBe(
      'walletManagement.import.connectWith:Alby Hub',
    );
    expect(wrapper.find('[data-testid="connect-coinos"]').text()).toBe(
      'walletManagement.import.connectWith:Coinos',
    );
  });

  it('connects Coinos and reloads the wallet list', async () => {
    mocks.connect.mockResolvedValue({
      status: 'connected',
      connection: { id: 'w', label: 'Coinos' },
    });
    const wrapper = await mountPage();

    await wrapper.find('[data-testid="connect-coinos"]').trigger('click');
    await flushPromises();

    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledWith('coinos', ALICE.id, undefined);
    expect(mocks.notify).toHaveBeenCalledWith({
      type: 'positive',
      message: 'walletManagement.notifications.connected:Coinos',
    });
    expect(mocks.listNip47Connections).toHaveBeenCalledTimes(2);
  });

  it('connects a self-hosted Alby Hub at the address the user gives', async () => {
    mocks.connect.mockResolvedValue({
      status: 'connected',
      connection: { id: 'w', label: 'Alby Hub' },
    });
    const wrapper = await mountPage();

    await wrapper.find('input.toggle').setValue(true);
    await wrapper.find('input:not(.toggle)').setValue('https://hub.example.com');
    await wrapper.find('[data-testid="connect-alby-hub"]').trigger('click');
    await flushPromises();

    expect(mocks.connect).toHaveBeenCalledWith('alby-hub', ALICE.id, 'https://hub.example.com');
  });

  it('opens the paste option when the wallet does not confirm', async () => {
    mocks.connect.mockResolvedValue({ status: 'no-response' });
    const wrapper = await mountPage();

    await wrapper.find('[data-testid="connect-coinos"]').trigger('click');
    await flushPromises();

    expect(mocks.notify).toHaveBeenCalledWith({
      type: 'warning',
      message: 'walletManagement.notifications.noResponse:Coinos',
    });
    expect(wrapper.find('.expansion').attributes('data-open')).toBe('true');
  });

  it('tells an Alby account without a Hub to use its own Hub (workspace#149)', async () => {
    mocks.connect.mockResolvedValue({ status: 'no-response' });
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="alby-hub-account-note"]').text()).toBe(
      'walletManagement.import.albyAccountNote',
    );
    await wrapper.find('[data-testid="connect-alby-hub"]').trigger('click');
    await flushPromises();

    expect(mocks.notify).toHaveBeenCalledWith({
      type: 'warning',
      message: 'walletManagement.notifications.noResponseAlbyHub',
    });
    expect(wrapper.find('.expansion').attributes('data-open')).toBe('true');
  });

  it('warns that a Hub on the home network is reached without encryption (workspace#149)', async () => {
    mocks.connect.mockResolvedValue({ status: 'no-response' });
    const wrapper = await mountPage();
    const warning = () => wrapper.find('[data-testid="custom-hub-unencrypted"]');

    await wrapper.find('input.toggle').setValue(true);
    const address = wrapper.find('input:not(.toggle)');
    await address.setValue('https://hub.example.com');
    expect(warning().exists()).toBe(false);

    await address.setValue('http://umbrel.local:59000');
    expect(warning().text()).toBe('walletManagement.import.customHubUnencrypted');

    // A public http address is refused when connecting, so it gets no warning to accept.
    await address.setValue('http://hub.example.com');
    expect(warning().exists()).toBe(false);

    await address.setValue('http://umbrel.local:59000');
    await wrapper.find('[data-testid="connect-alby-hub"]').trigger('click');
    await flushPromises();
    expect(mocks.connect).toHaveBeenCalledWith('alby-hub', ALICE.id, 'http://umbrel.local:59000');
    // The user already chose their own Hub, so the Hub-less-account advice would not help.
    expect(mocks.notify).toHaveBeenCalledWith({
      type: 'warning',
      message: 'walletManagement.notifications.noResponse:Alby Hub',
    });
  });

  it('explains a blocked popup', async () => {
    mocks.connect.mockResolvedValue({ status: 'popup-blocked' });
    const wrapper = await mountPage();

    await wrapper.find('[data-testid="connect-coinos"]').trigger('click');
    await flushPromises();

    expect(mocks.notify).toHaveBeenCalledWith({
      type: 'warning',
      message: 'walletManagement.notifications.popupBlocked',
    });
  });

  it('says nothing when the user closes the connect window', async () => {
    mocks.connect.mockResolvedValue({ status: 'cancelled' });
    const wrapper = await mountPage();
    mocks.notify.mockClear();

    await wrapper.find('[data-testid="connect-coinos"]').trigger('click');
    await flushPromises();

    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.listNip47Connections).toHaveBeenCalledOnce();
  });

  it('shows an error when connecting fails', async () => {
    mocks.connect.mockRejectedValue(new Error('Vault is locked'));
    const wrapper = await mountPage();

    await wrapper.find('[data-testid="connect-coinos"]').trigger('click');
    await flushPromises();

    expect(mocks.notify).toHaveBeenCalledWith({ type: 'negative', message: 'Vault is locked' });
  });

  it('says why a pasted string is unusable and will not import it', async () => {
    const wrapper = await mountPage();

    await wrapper.find('[data-testid="nwc-uri"] input').setValue('nostr+walletconnect://nope');

    expect(wrapper.find('[data-testid="nwc-uri"] .error').text()).toContain(
      'walletManagement.import.invalidUri',
    );
    expect(wrapper.find('[data-testid="import-connection"]').attributes('disabled')).toBeDefined();
  });

  it('imports a pasted string and checks it straight away', async () => {
    mocks.importNip47Connection.mockResolvedValue({ id: 'pasted' });
    mocks.getNip47Info.mockResolvedValue({
      capabilities: ['pay_invoice'],
      checkedAt: '2026-10-12T00:00:00.000Z',
    });
    const wrapper = await mountPage();

    await wrapper.find('[data-testid="nwc-uri"] input').setValue(VALID_URI);
    expect(wrapper.find('[data-testid="nwc-uri"] .error').exists()).toBe(false);
    await wrapper.find('[data-testid="import-connection"]').trigger('click');
    await flushPromises();

    expect(mocks.importNip47Connection).toHaveBeenCalledWith({
      accountPubkey: ALICE.id,
      uri: VALID_URI,
    });
    expect(mocks.getNip47Info).toHaveBeenCalledWith(ALICE.id, 'pasted');
  });

  it('says a paying wallet is ready for payments and that websites pay only through WebLN (#291)', async () => {
    mocks.listNip47Connections.mockResolvedValue([
      {
        id: 'w',
        accountPubkey: ALICE.id,
        label: 'Alby Hub',
        walletServicePubkey: 'b'.repeat(64),
        clientPubkey: 'c'.repeat(64),
        relays: ['wss://relay.example.com'],
        capabilities: ['pay_invoice'],
        createdAt: '2026-10-12T00:00:00.000Z',
        updatedAt: '2026-10-12T00:00:00.000Z',
        isActive: true,
        hasClientSecret: true,
      },
    ]);
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('walletManagement.status.readyForPayments');
    expect(wrapper.text()).toContain('walletManagement.security.websitePayments');
  });
});

describe('the wallets shown are the active account’s (#304)', () => {
  it('names the account and lists only its wallets and payments', async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="wallet-account"]').text()).toBe(
      'walletManagement.accountCaption:alice',
    );
    expect(mocks.listNip47Connections).toHaveBeenCalledWith(ALICE.id);
    expect(mocks.listNip47PaymentHistory).toHaveBeenCalledWith(ALICE.id);
  });

  it('reloads for the new account when the user switches, and drops the old one’s wallets', async () => {
    mocks.listNip47Connections.mockImplementation((owner: string) =>
      Promise.resolve(
        owner === ALICE.id
          ? [
              {
                id: 'alice-wallet',
                accountPubkey: ALICE.id,
                label: 'Alice wallet',
                walletServicePubkey: 'w',
                clientPubkey: 'c',
                relays: [],
                capabilities: [],
                createdAt: '2026-01-01',
                updatedAt: '2026-01-01',
                isActive: true,
                hasClientSecret: true,
              },
            ]
          : [],
      ),
    );
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('Alice wallet');

    accountStore().activeAccount = BOB;
    await flushPromises();

    expect(mocks.listNip47Connections).toHaveBeenLastCalledWith(BOB.id);
    expect(wrapper.text()).not.toContain('Alice wallet');
    expect(wrapper.find('[data-testid="wallet-account"]').text()).toBe(
      'walletManagement.accountCaption:bob',
    );
  });

  it('shows and loads nothing without an active account', async () => {
    accountStore().activeAccount = undefined;

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="wallet-account"]').text()).toBe(
      'walletManagement.noAccount',
    );
    expect(mocks.listNip47Connections).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="connect-coinos"]').exists()).toBe(false);
  });
});
