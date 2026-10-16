import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendBexMessage } = vi.hoisted(() => ({ sendBexMessage: vi.fn() }));

vi.mock('@/services/vault-service', () => ({ sendBexMessage }));

import {
  beginNip47Authorization,
  completeNip47Authorization,
  getNip47Balance,
  getNip47Info,
  listNip47Connections,
  listNip47PaymentHistory,
  payNip47Invoice,
  probeNip47Authorization,
  removeNip47Connection,
  setActiveNip47Connection,
} from '@/services/nip47-service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ACCOUNT = 'a'.repeat(64);

describe('nip47-service wallet authorization (#110)', () => {
  const start = { pendingId: 'p', clientPubkey: 'c', origin: 'https://coinos.io', authorizationUrl: 'https://coinos.io/apps/new' };
  const completion = { pendingId: 'p', walletServicePubkey: 'w', relays: ['wss://r'] };

  it('begins an authorization in the background', async () => {
    sendBexMessage.mockResolvedValue(start);

    await expect(beginNip47Authorization({ accountPubkey: ACCOUNT, provider: 'coinos' })).resolves.toEqual(start);
    expect(sendBexMessage).toHaveBeenCalledWith('nip47.authorization.begin', { accountPubkey: ACCOUNT, provider: 'coinos' });
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

    await expect(beginNip47Authorization({ accountPubkey: ACCOUNT, provider: 'coinos' })).rejects.toThrow('Vault is locked');
    await expect(completeNip47Authorization(completion)).rejects.toThrow('Vault is locked');
    await expect(probeNip47Authorization('p')).rejects.toThrow('Vault is locked');
  });

  it('rejects malformed responses', async () => {
    sendBexMessage.mockResolvedValue({});

    await expect(beginNip47Authorization({ accountPubkey: ACCOUNT, provider: 'coinos' })).rejects.toThrow('Invalid wallet authorization response');
    await expect(completeNip47Authorization(completion)).rejects.toThrow('Invalid wallet authorization response');
  });
});

describe('nip47-service names the account on every wallet call (#304)', () => {
  it('sends the account with each request', async () => {
    sendBexMessage.mockResolvedValue([]);
    await listNip47Connections(ACCOUNT);
    await listNip47PaymentHistory(ACCOUNT);
    expect(sendBexMessage).toHaveBeenCalledWith('nip47.connections.list', { accountPubkey: ACCOUNT });
    expect(sendBexMessage).toHaveBeenCalledWith('nip47.payments.list', { accountPubkey: ACCOUNT });

    sendBexMessage.mockResolvedValue({ id: 'w', balanceMsat: 1, capabilities: [], preimage: 'p' });
    await setActiveNip47Connection(ACCOUNT, 'w');
    await getNip47Info(ACCOUNT, 'w');
    await getNip47Balance(ACCOUNT, 'w');
    await payNip47Invoice(ACCOUNT, 'w', 'lnbc1');
    await removeNip47Connection(ACCOUNT, 'w');
    expect(sendBexMessage).toHaveBeenCalledWith('nip47.connections.setActive', { accountPubkey: ACCOUNT, connectionId: 'w' });
    expect(sendBexMessage).toHaveBeenCalledWith('nip47.getInfo', { accountPubkey: ACCOUNT, connectionId: 'w' });
    expect(sendBexMessage).toHaveBeenCalledWith('nip47.getBalance', { accountPubkey: ACCOUNT, connectionId: 'w' });
    expect(sendBexMessage).toHaveBeenCalledWith('nip47.payInvoice', { accountPubkey: ACCOUNT, connectionId: 'w', invoice: 'lnbc1' });
    expect(sendBexMessage).toHaveBeenCalledWith('nip47.connections.remove', { accountPubkey: ACCOUNT, connectionId: 'w' });
  });

  it('reports an error listing connections rather than an empty list', async () => {
    sendBexMessage.mockResolvedValue({ success: false, error: 'Account not found' });

    await expect(listNip47Connections(ACCOUNT)).rejects.toThrow('Account not found');
  });
});
