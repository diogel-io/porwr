import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import type { StoredKey } from '@/types';

const uploadImageToBlossomMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/blossom-upload-service', () => ({
  uploadImageToBlossom: uploadImageToBlossomMock,
}));

vi.mock('@/services/storage-service', () => ({
  storageService: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    remove: vi.fn(),
    onChanged: vi.fn(),
    removeOnChanged: vi.fn(),
  },
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

const mockStoredKey: StoredKey = {
  id: 'test-pubkey',
  alias: 'test',
  account: { privkey: 'test-privkey' },
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
        uploadId: 'avatar',
      }),
    );

    // Should emit uploaded with the URL
    expect(wrapper.emitted('uploaded')).toBeTruthy();
    expect(wrapper.emitted('uploaded')![0]).toEqual(['https://blossom.example.com/avatar.png']);
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
    expect(uploadedEvents[0]).toEqual(['https://blossom.example.com/img.png']);
  });
});