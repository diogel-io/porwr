import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

import KeyManagementTable from '@/components/dashboard/key-management/KeyManagementTable.vue';
import type { StoredKey } from '@/types';

const notifyMock = vi.fn();
const clipboardWriteTextMock = vi.fn();

const npubEncodeMock = vi.fn((value: string) => `npub_${value}`);

vi.mock('nostr-tools/nip19', () => ({
  npubEncode: (value: string) => npubEncodeMock(value),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    d: (date: Date) => `formatted:${date.toISOString()}`,
  }),
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({
    notify: notifyMock,
  }),
}));

const globalStubs = {
  'q-table': {
    template: `<div class="q-table-stub">
      <div v-for="row in rows" :key="row.alias" class="row-item">
        <span class="row-alias">{{ row.alias }}</span>
        <slot name="body-cell-npub" :row="row" :props="{ row }" />
        <slot name="body-cell-createdAt" :row="row" :props="{ row }" />
        <slot name="body-cell-action" :row="row" :props="{ row }" />
      </div>
    </div>`,
    props: ['columns', 'rows', 'noDataLabel', 'rowKey'],
  },
  'q-td': {
    template: '<div class="q-td-stub"><slot /></div>',
    props: ['props'],
  },
  'q-btn': {
    template:
      '<button class="q-btn-stub" :data-to-name="to?.name" :data-to-alias="to?.params?.alias" :data-label="label" :data-icon="icon" :disabled="disable" @click="!disable && $emit(\'click\', $event)"><slot /></button>',
    props: ['to', 'label', 'icon', 'disable'],
  },
};

describe('KeyManagementTable.vue', () => {
  Object.assign(navigator, {
    clipboard: {
      writeText: clipboardWriteTextMock,
    },
  });

  clipboardWriteTextMock.mockResolvedValue(undefined);

  beforeEach(() => {
    notifyMock.mockReset();
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockResolvedValue(undefined);
    npubEncodeMock.mockReset();
    npubEncodeMock.mockImplementation((value: string) => `npub_${value}`);
  });

  it('renders key rows with npub-encoded public keys', () => {
    const keys: StoredKey[] = [
      {
        id: 'pubkey-a',
        alias: 'alpha',
        account: { privkey: 'secret-a' },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'pubkey-b',
        alias: 'beta',
        account: { privkey: 'secret-b' },
        createdAt: '2026-02-01T00:00:00.000Z',
      },
    ];

    const wrapper = mount(KeyManagementTable, {
      props: { keys },
      global: { stubs: globalStubs },
    });

    expect(wrapper.findAll('.row-item')).toHaveLength(2);
    expect(wrapper.text()).toContain('alpha');
    expect(wrapper.text()).toContain('beta');
    expect(wrapper.text()).toContain('npub_pubkey-a');
    expect(wrapper.text()).toContain('npub_pubkey-b');
    expect(wrapper.text()).toContain('formatted:2026-01-01T00:00:00.000Z');
    expect(wrapper.text()).toContain('formatted:2026-02-01T00:00:00.000Z');
  });

  it('keeps copy action in public key cell and view action in action cell', () => {
    const keys: StoredKey[] = [
      {
        id: 'pubkey-a',
        alias: 'alpha',
        account: { privkey: 'secret-a' },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const wrapper = mount(KeyManagementTable, {
      props: { keys },
      global: { stubs: globalStubs },
    });

    const publicKeyCell = wrapper.find('.key-management-table__public-key-cell');
    expect(publicKeyCell.exists()).toBe(true);
    expect(publicKeyCell.find('[data-icon="content_copy"]').exists()).toBe(true);

    const actionCell = wrapper.find('.key-management-table__action-cell');
    expect(actionCell.exists()).toBe(true);
    expect(actionCell.find('[data-label="keyManagement.viewAction"]').exists()).toBe(true);
    expect(actionCell.find('[data-icon="content_copy"]').exists()).toBe(false);
  });

  it('shows unknown date when createdAt is invalid', () => {
    const keys: StoredKey[] = [
      {
        id: 'pubkey-a',
        alias: 'alpha',
        account: { privkey: 'secret-a' },
        createdAt: 'not-a-date',
      },
    ];

    const wrapper = mount(KeyManagementTable, {
      props: { keys },
      global: { stubs: globalStubs },
    });

    expect(wrapper.text()).toContain('keyManagement.table.unknownDate');
  });

  it('shows unknown date when createdAt is missing', () => {
    const keys = [
      {
        id: 'pubkey-a',
        alias: 'alpha',
        account: { privkey: 'secret-a' },
      },
    ] as unknown as StoredKey[];

    const wrapper = mount(KeyManagementTable, {
      props: { keys },
      global: { stubs: globalStubs },
    });

    expect(wrapper.text()).toContain('keyManagement.table.unknownDate');
  });

  it('copies full npub value from copy action', async () => {
    const keys: StoredKey[] = [
      {
        id: 'pubkey-a',
        alias: 'alpha',
        account: { privkey: 'secret-a' },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const wrapper = mount(KeyManagementTable, {
      props: { keys },
      global: { stubs: globalStubs },
    });

    const copyButton = wrapper.find('[data-icon="content_copy"]');
    await copyButton.trigger('click');

    expect(clipboardWriteTextMock).toHaveBeenCalledWith('npub_pubkey-a');
    expect(notifyMock).toHaveBeenCalledWith({
      type: 'positive',
      message: 'account.copySuccess',
    });
  });

  it('shows negative notification when clipboard write fails', async () => {
    clipboardWriteTextMock.mockRejectedValueOnce(new Error('clipboard denied'));

    const keys: StoredKey[] = [
      {
        id: 'pubkey-a',
        alias: 'alpha',
        account: { privkey: 'secret-a' },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const wrapper = mount(KeyManagementTable, {
      props: { keys },
      global: { stubs: globalStubs },
    });

    const copyButton = wrapper.find('[data-icon="content_copy"]');
    await copyButton.trigger('click');

    expect(clipboardWriteTextMock).toHaveBeenCalledWith('npub_pubkey-a');
    expect(notifyMock).toHaveBeenCalledWith({
      type: 'negative',
      message: 'keyManagement.table.copyPublicKeyFailed',
    });
  });

  it('disables copy action when npub encoding fails', async () => {
    npubEncodeMock.mockImplementationOnce(() => {
      throw new Error('invalid key');
    });

    const keys: StoredKey[] = [
      {
        id: 'pubkey-a',
        alias: 'alpha',
        account: { privkey: 'secret-a' },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const wrapper = mount(KeyManagementTable, {
      props: { keys },
      global: { stubs: globalStubs },
    });

    const copyButton = wrapper.find('[data-icon="content_copy"]');
    expect(copyButton.attributes('disabled')).toBeDefined();

    await copyButton.trigger('click');
    expect(clipboardWriteTextMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('binds View action route to selected alias', () => {
    const keys: StoredKey[] = [
      {
        id: 'pubkey-a',
        alias: 'alpha',
        account: { privkey: 'secret-a' },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const wrapper = mount(KeyManagementTable, {
      props: { keys },
      global: { stubs: globalStubs },
    });

    const viewButton = wrapper.find('[data-label="keyManagement.viewAction"]');
    expect(viewButton.exists()).toBe(true);
    expect(viewButton.attributes('data-to-name')).toBe('view-key');
    expect(viewButton.attributes('data-to-alias')).toBe('alpha');
  });
});
