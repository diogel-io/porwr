import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import type { AccountSummary } from '@/types/accounts';

const uploadImageToBlossomMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/blossom-upload-service', () => ({
  uploadImageToBlossom: uploadImageToBlossomMock,
}));

const storageMock = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn(),
  remove: vi.fn(),
  onChanged: vi.fn(),
  removeOnChanged: vi.fn(),
}));

vi.mock('@/services/storage-service', () => ({
  storageService: storageMock,
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'profile.uploadSuccess': 'Upload successful',
        'profile.uploadError': 'Upload failed',
      };
      return translations[key] ?? key;
    },
  }),
}));

const mockNotify = vi.fn();
vi.mock('quasar', () => ({
  useQuasar: () => ({
    notify: mockNotify,
  }),
}));

// Import after mocks
import ImageUploader from '@/components/dashboard/ImageUploader.vue';

// What a page holds for an account since #243: no key.
const mockStoredKey: AccountSummary = {
  id: 'test-pubkey',
  alias: 'test',
  createdAt: '2026-01-01',
};

function createFile(name: string, type: string): File {
  return new File(['test-image-data'], name, { type });
}

describe('ImageUploader.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadImageToBlossomMock.mockReset();
  });

  it('renders the upload button', () => {
    const wrapper = mount(ImageUploader, {
      props: { storedKey: mockStoredKey },
      global: {
        stubs: {
          qBtn: { template: '<button><slot /></button>' },
          qTooltip: { template: '<span><slot /></span>' },
        },
      },
    });

    expect(wrapper.find('button').exists()).toBe(true);
  });

  it('does not require $q.bex to exist', () => {
    // The component should mount without error even though there's no BEX bridge
    const wrapper = mount(ImageUploader, {
      props: { storedKey: mockStoredKey },
      global: {
        stubs: {
          qBtn: { template: '<button><slot /></button>' },
          qTooltip: { template: '<span><slot /></span>' },
        },
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it('calls uploadImageToBlossom on file selection and emits uploaded with URL', async () => {
    uploadImageToBlossomMock.mockResolvedValue({
      url: 'https://blossom.example.com/avatar.png',
    });

    const wrapper = mount(ImageUploader, {
      props: { storedKey: mockStoredKey, uploadId: 'avatar' },
      global: {
        stubs: {
          qBtn: { template: '<button><slot /></button>' },
          qTooltip: { template: '<span><slot /></span>' },
        },
      },
    });

    const file = createFile('avatar.png', 'image/png');
    const vm = wrapper.vm as unknown as { handleFileChange(e: Event): Promise<void> };

    // Simulate file input change
    const inputEvent = {
      target: { files: [file] },
    } as unknown as Event;

    await vm.handleFileChange(inputEvent);

    expect(uploadImageToBlossomMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileType: 'image/png',
        uploadId: 'avatar:test-pubkey',
      }),
    );

    // Should emit uploaded with the URL
    expect(wrapper.emitted('uploaded')).toBeTruthy();
    expect(wrapper.emitted('uploaded')![0]).toEqual([
      'https://blossom.example.com/avatar.png',
      'test-pubkey',
    ]);
    // Should also emit the avatar-specific event
    expect(wrapper.emitted('avatar-uploaded')).toBeTruthy();
  });

  it('emits uploading true then false during upload', async () => {
    let resolveUpload: (value: unknown) => void;
    const uploadPromise = new Promise((resolve) => {
      resolveUpload = resolve;
    });
    uploadImageToBlossomMock.mockReturnValue(uploadPromise);

    const wrapper = mount(ImageUploader, {
      props: { storedKey: mockStoredKey },
      global: {
        stubs: {
          qBtn: { template: '<button><slot /></button>' },
          qTooltip: { template: '<span><slot /></span>' },
        },
      },
    });

    const file = createFile('test.jpg', 'image/jpeg');
    const vm = wrapper.vm as unknown as { handleFileChange(e: Event): Promise<void> };

    const inputEvent = {
      target: { files: [file] },
    } as unknown as Event;

    const uploadCall = vm.handleFileChange(inputEvent);

    // Wait for Vue to process the next tick
    await wrapper.vm.$nextTick();

    // Should have emitted uploading: true
    expect(wrapper.emitted('uploading')).toBeTruthy();
    expect(wrapper.emitted('uploading')![0]).toEqual([true]);

    // Resolve the upload
    resolveUpload!({ url: 'https://blossom.example.com/test.jpg' });
    await uploadCall;
    await wrapper.vm.$nextTick();

    // Should have emitted uploading: false
    const uploadingEvents = wrapper.emitted('uploading')!;
    expect(uploadingEvents[uploadingEvents.length - 1]).toEqual([false]);
  });

  it('shows negative notification when service throws', async () => {
    uploadImageToBlossomMock.mockRejectedValue(new Error('Upload server error'));

    const wrapper = mount(ImageUploader, {
      props: { storedKey: mockStoredKey },
      global: {
        stubs: {
          qBtn: { template: '<button><slot /></button>' },
          qTooltip: { template: '<span><slot /></span>' },
        },
      },
    });

    const file = createFile('fail.png', 'image/png');
    const vm = wrapper.vm as unknown as { handleFileChange(e: Event): Promise<void> };

    const inputEvent = {
      target: { files: [file] },
    } as unknown as Event;

    await vm.handleFileChange(inputEvent);

    expect(mockNotify).toHaveBeenCalledWith({
      type: 'negative',
      message: 'Upload server error',
    });

    // Uploading should be cleared even on error
    const uploadingEvents = wrapper.emitted('uploading')!;
    expect(uploadingEvents[uploadingEvents.length - 1]).toEqual([false]);
  });

  it('does not duplicate emitted URL from direct response and storage listener', async () => {
    uploadImageToBlossomMock.mockResolvedValue({
      url: 'https://blossom.example.com/img.png',
    });

    const wrapper = mount(ImageUploader, {
      props: { storedKey: mockStoredKey, uploadId: 'avatar' },
      global: {
        stubs: {
          qBtn: { template: '<button><slot /></button>' },
          qTooltip: { template: '<span><slot /></span>' },
        },
      },
    });

    const file = createFile('img.png', 'image/png');
    const vm = wrapper.vm as unknown as { handleFileChange(e: Event): Promise<void> };
    const inputEvent = {
      target: { files: [file] },
    } as unknown as Event;

    await vm.handleFileChange(inputEvent);

    // Only one uploaded event with the URL
    const uploadedEvents = wrapper.emitted('uploaded')!;
    expect(uploadedEvents.length).toBe(1);
    expect(uploadedEvents[0]).toEqual(['https://blossom.example.com/img.png', 'test-pubkey']);
  });

  describe('the storage listener (#252)', () => {
    const stubs = {
      qBtn: { template: '<button><slot /></button>' },
      qTooltip: { template: '<span><slot /></span>' },
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('removes exactly the listener it added when unmounted, without a lifecycle warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const wrapper = mount(ImageUploader, {
        props: { storedKey: mockStoredKey, uploadId: 'avatar' },
        global: { stubs },
      });
      await settle();

      expect(storageMock.onChanged).toHaveBeenCalledTimes(1);
      const added = storageMock.onChanged.mock.calls[0]![0] as unknown;

      wrapper.unmount();

      expect(storageMock.removeOnChanged).toHaveBeenCalledWith(added);
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/no active component instance/);
      warn.mockRestore();
    });

    it('adds no listener when it is unmounted before the stored status is read', async () => {
      let finishRead: (value: null) => void = () => undefined;
      storageMock.get.mockImplementationOnce(
        () => new Promise<null>((resolve) => (finishRead = resolve)),
      );
      const wrapper = mount(ImageUploader, {
        props: { storedKey: mockStoredKey, uploadId: 'avatar' },
        global: { stubs },
      });

      wrapper.unmount();
      finishRead(null);
      await settle();

      expect(storageMock.onChanged).not.toHaveBeenCalled();
    });
  });

  describe('an upload error left in storage (porwr#370)', () => {
    const stubs = {
      qBtn: { template: '<button><slot /></button>' },
      qTooltip: { template: '<span><slot /></span>' },
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const mountWithStored = async (error: string) => {
      storageMock.get.mockResolvedValueOnce({ uploading: false, error });
      mount(ImageUploader, { props: { storedKey: mockStoredKey }, global: { stubs } });
      await settle();
    };

    it.each(['too_large', 'unauthorized', 'not_https', 'failed'])(
      'shows Porwr’s message for %s',
      async (code) => {
        await mountWithStored(code);

        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'negative', message: `profile.uploadErrors.${code}` }),
        );
      },
    );

    it('never shows text it does not recognise, such as a server’s words stored before codes', async () => {
      await mountWithStored('HTTP Error 500: Internal. balance 4200 sats');

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative', message: 'Upload failed' }),
      );
    });

    it('maps a code that arrives while the page is open', async () => {
      mount(ImageUploader, { props: { storedKey: mockStoredKey }, global: { stubs } });
      await settle();
      const listener = storageMock.onChanged.mock.calls.at(-1)?.[0] as (
        changes: Record<string, { newValue: unknown }>,
        area: string,
      ) => void;

      listener(
        {
          'blossom:upload_status:image:test-pubkey': {
            newValue: { uploading: false, error: 'too_large' },
          },
        },
        'local',
      );

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'profile.uploadErrors.too_large' }),
      );
    });
  });

  describe('uploads belong to the account they started for (#400)', () => {
    const stubs = {
      qBtn: { template: '<button><slot /></button>' },
      qTooltip: { template: '<span><slot /></span>' },
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const other: AccountSummary = { id: 'other-pubkey', alias: 'other', createdAt: '2026-01-01' };
    const fileEvent = (name: string) =>
      ({ target: { files: [createFile(name, 'image/png')] } }) as unknown as Event;
    type Listener = (changes: Record<string, { newValue: unknown }>, area: string) => void;

    it('emits the account the upload started for, though the page switched account meanwhile', async () => {
      let finishUpload: (value: unknown) => void = () => undefined;
      uploadImageToBlossomMock.mockReturnValue(new Promise((resolve) => (finishUpload = resolve)));
      const wrapper = mount(ImageUploader, {
        props: { storedKey: mockStoredKey, uploadId: 'banner' },
        global: { stubs },
      });
      const vm = wrapper.vm as unknown as { handleFileChange(e: Event): Promise<void> };

      const upload = vm.handleFileChange(fileEvent('banner.png'));
      await wrapper.setProps({ storedKey: other });
      finishUpload({ url: 'https://blossom.example.com/banner.png' });
      await upload;

      expect(uploadImageToBlossomMock).toHaveBeenCalledWith(
        expect.objectContaining({ uploadId: 'banner:test-pubkey' }),
      );
      expect(wrapper.emitted('banner-uploaded')).toEqual([
        ['https://blossom.example.com/banner.png', 'test-pubkey'],
      ]);
    });

    it('emits the same image uploaded for two accounts once for each', async () => {
      uploadImageToBlossomMock.mockResolvedValue({ url: 'https://blossom.example.com/same.png' });
      const wrapper = mount(ImageUploader, {
        props: { storedKey: mockStoredKey, uploadId: 'banner' },
        global: { stubs },
      });
      const vm = wrapper.vm as unknown as { handleFileChange(e: Event): Promise<void> };

      await vm.handleFileChange(fileEvent('same.png'));
      await wrapper.setProps({ storedKey: other });
      await vm.handleFileChange(fileEvent('same.png'));

      expect(wrapper.emitted('banner-uploaded')).toEqual([
        ['https://blossom.example.com/same.png', 'test-pubkey'],
        ['https://blossom.example.com/same.png', 'other-pubkey'],
      ]);
    });

    it('reads only its own account’s stored status, and drops the old shared one unread', async () => {
      mount(ImageUploader, {
        props: { storedKey: mockStoredKey, uploadId: 'banner' },
        global: { stubs },
      });
      await settle();

      expect(storageMock.get).toHaveBeenCalledWith('blossom:upload_status:banner:test-pubkey');
      expect(storageMock.get).not.toHaveBeenCalledWith('blossom:upload_status:banner');
      expect(storageMock.remove).toHaveBeenCalledWith('blossom:upload_status:banner');
    });

    it('ignores a finished upload stored for another account', async () => {
      const wrapper = mount(ImageUploader, {
        props: { storedKey: mockStoredKey, uploadId: 'banner' },
        global: { stubs },
      });
      await settle();
      const listener = storageMock.onChanged.mock.calls.at(-1)?.[0] as Listener;

      listener(
        {
          'blossom:upload_status:banner:other-pubkey': {
            newValue: { uploading: false, url: 'https://blossom.example.com/theirs.png' },
          },
        },
        'local',
      );

      expect(wrapper.emitted('banner-uploaded')).toBeUndefined();
      expect(storageMock.remove).not.toHaveBeenCalledWith(
        'blossom:upload_status:banner:other-pubkey',
      );
    });

    it('applies a stored upload for the new account, with that account, after a switch', async () => {
      const wrapper = mount(ImageUploader, {
        props: { storedKey: mockStoredKey, uploadId: 'banner' },
        global: { stubs },
      });
      await settle();
      storageMock.get.mockImplementation(async (key: string) =>
        key === 'blossom:upload_status:banner:other-pubkey'
          ? { uploading: false, url: 'https://blossom.example.com/theirs.png' }
          : null,
      );

      await wrapper.setProps({ storedKey: other });
      await settle();

      expect(wrapper.emitted('banner-uploaded')).toEqual([
        ['https://blossom.example.com/theirs.png', 'other-pubkey'],
      ]);
      storageMock.get.mockReset();
      storageMock.get.mockResolvedValue(null);
    });
  });
});
