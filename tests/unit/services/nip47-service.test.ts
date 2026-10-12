import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendBexMessage } = vi.hoisted(() => ({ sendBexMessage: vi.fn() }));

vi.mock('@/services/vault-service', () => ({ sendBexMessage }));

import {
  beginNip47Authorization,
  completeNip47Authorization,
  probeNip47Authorization,
} from '@/services/nip47-service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('nip47-service wallet authorization (#110)', () => {
  const start = { pendingId: 'p', clientPubkey: 'c', origin: 'https://coinos.io', authorizationUrl: 'https://coinos.io/apps/new' };
  const completion = { pendingId: 'p', walletServicePubkey: 'w', relays: ['wss://r'] };

  it('begins an authorization in the background', async () => {
    sendBexMessage.mockResolvedValue(start);

    await expect(beginNip47Authorization({ provider: 'coinos' })).resolves.toEqual(start);
    expect(sendBexMessage).toHaveBeenCalledWith('nip47.authorization.begin', { provider: 'coinos' });
  });

  it('completes an authorization in the background', async () => {
    sendBexMessage.mockResolvedValue({ id: 'w' });

    await expect(completeNip47Authorization(completion)).resolves.toEqual({ id: 'w' });
    expect(sendBexMessage).toHaveBeenCalledWith('nip47.authorization.complete', completion);
  });

  it('probes an authorization, returning null when the wallet did not approve it', async () => {
    sendBexMessage.mockResolvedValueOnce({ id: 'w' }).mockResolvedValueOnce(null);

    await expect(probeNip47Authorization('p')).resolves.toEqual({ id: 'w' });
    await expect(probeNip47Authorization('p')).resolves.toBeNull();
    expect(sendBexMessage).toHaveBeenCalledWith('nip47.authorization.probe', { pendingId: 'p' });
  });

  it('surfaces background errors', async () => {
    sendBexMessage.mockResolvedValue({ success: false, error: 'Vault is locked' });

    await expect(beginNip47Authorization({ provider: 'coinos' })).rejects.toThrow('Vault is locked');
    await expect(completeNip47Authorization(completion)).rejects.toThrow('Vault is locked');
    await expect(probeNip47Authorization('p')).rejects.toThrow('Vault is locked');
  });

  it('rejects malformed responses', async () => {
    sendBexMessage.mockResolvedValue({});

    await expect(beginNip47Authorization({ provider: 'coinos' })).rejects.toThrow('Invalid wallet authorization response');
    await expect(completeNip47Authorization(completion)).rejects.toThrow('Invalid wallet authorization response');
  });
});
