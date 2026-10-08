import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendBexMessageMock, getSettingsMock } = vi.hoisted(() => ({
  sendBexMessageMock: vi.fn(),
  getSettingsMock: vi.fn(),
}));

vi.mock('@/services/vault-service', () => ({
  sendBexMessage: sendBexMessageMock,
}));

vi.mock('@/stores/settings-store', () => ({
  default: vi.fn(() => ({
    blossomServer: 'https://blossom.default.example.com',
    getSettings: getSettingsMock,
  })),
}));

describe('blossom-upload-service', () => {
  let uploadImageToBlossom: typeof import('@/services/blossom-upload-service').uploadImageToBlossom;

  beforeEach(async () => {
    vi.clearAllMocks();
    getSettingsMock.mockResolvedValue(undefined);
    sendBexMessageMock.mockReset();

    // Re-import to get fresh module with reset mocks
    const module = await import('@/services/blossom-upload-service');
    uploadImageToBlossom = module.uploadImageToBlossom;
  });

  it('calls sendBexMessage with blossom.upload and returns URL on success', async () => {
    sendBexMessageMock.mockResolvedValue({
      success: true,
      url: 'https://blossom.example.com/image.png',
    });

    const result = await uploadImageToBlossom({
      base64Data: 'iVBORw...',
      fileType: 'image/png',
    });

    expect(result).toEqual({ url: 'https://blossom.example.com/image.png' });
    expect(sendBexMessageMock).toHaveBeenCalledWith('blossom.upload', {
      base64Data: 'iVBORw...',
      fileType: 'image/png',
      blossomServer: 'https://blossom.default.example.com',
    });
  });

  it('includes uploadId when provided', async () => {
    sendBexMessageMock.mockResolvedValue({
      success: true,
      url: 'https://blossom.example.com/avatar.png',
    });

    await uploadImageToBlossom({
      base64Data: 'abc123',
      fileType: 'image/jpeg',
      uploadId: 'avatar',
    });

    expect(sendBexMessageMock).toHaveBeenCalledWith('blossom.upload', {
      base64Data: 'abc123',
      fileType: 'image/jpeg',
      blossomServer: 'https://blossom.default.example.com',
      uploadId: 'avatar',
    });
  });

  it('does not include uploadId when omitted', async () => {
    sendBexMessageMock.mockResolvedValue({
      success: true,
      url: 'https://blossom.example.com/image.png',
    });

    await uploadImageToBlossom({
      base64Data: 'abc123',
      fileType: 'image/png',
    });

    const callArgs = sendBexMessageMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('uploadId');
  });

  it('uses blossomServer from settings store', async () => {
    // The default mock returns 'https://blossom.default.example.com'.
    // This test verifies that the blossomServer is passed through.
    sendBexMessageMock.mockResolvedValue({
      success: true,
      url: 'https://blossom.default.example.com/img.webp',
    });

    await uploadImageToBlossom({
      base64Data: 'data',
      fileType: 'image/webp',
    });

    // blossomServer comes from the mocked settings store default
    expect(sendBexMessageMock).toHaveBeenCalledWith('blossom.upload', expect.objectContaining({
      blossomServer: 'https://blossom.default.example.com',
    }));
  });

  it('calls getSettings before sending message', async () => {
    sendBexMessageMock.mockResolvedValue({
      success: true,
      url: 'https://blossom.example.com/image.png',
    });

    await uploadImageToBlossom({
      base64Data: 'data',
      fileType: 'image/png',
    });

    expect(getSettingsMock).toHaveBeenCalled();
  });

  it('throws with error message when response has success: false', async () => {
    sendBexMessageMock.mockResolvedValue({
      success: false,
      error: 'No active account found',
    });

    await expect(
      uploadImageToBlossom({
        base64Data: 'data',
        fileType: 'image/png',
      }),
    ).rejects.toThrow('No active account found');
  });

  it('throws generic error when response is undefined/null', async () => {
    sendBexMessageMock.mockResolvedValue(undefined);

    await expect(
      uploadImageToBlossom({
        base64Data: 'data',
        fileType: 'image/png',
      }),
    ).rejects.toThrow('Image upload failed');
  });

  it('throws generic error when response is malformed', async () => {
    sendBexMessageMock.mockResolvedValue({});

    await expect(
      uploadImageToBlossom({
        base64Data: 'data',
        fileType: 'image/png',
      }),
    ).rejects.toThrow('Image upload failed');
  });

  it('throws generic error when response has error but no success field', async () => {
    sendBexMessageMock.mockResolvedValue({ error: 'Something went wrong' });

    await expect(
      uploadImageToBlossom({
        base64Data: 'data',
        fileType: 'image/png',
      }),
    ).rejects.toThrow('Something went wrong');
  });

  it('throws error from sendBexMessage when it rejects', async () => {
    sendBexMessageMock.mockRejectedValue(new Error('No communication channel available'));

    await expect(
      uploadImageToBlossom({
        base64Data: 'data',
        fileType: 'image/png',
      }),
    ).rejects.toThrow('No communication channel available');
  });
});