import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lockListeners, close } = vi.hoisted(() => ({
  lockListeners: [] as Array<() => void>,
  close: vi.fn(),
}));

vi.mock('@/../src-bex/vault', () => ({
  onVaultLocked: (listener: () => void) => lockListeners.push(listener),
}));
vi.mock('@/../src-bex/services/nip46-client', () => ({ nip46Client: { close } }));
vi.mock('@/../src-bex/services/panel-presence', () => ({ notifyPanelsOfQueueChange: vi.fn() }));

import {
  handleNip46AuthChallenges,
  handleNip46OpenAuthChallenge,
} from '@/../src-bex/handlers/nip46';
import { addAuthChallenge } from '@/../src-bex/services/nip46-auth-challenges';
import { notifyPanelsOfQueueChange } from '@/../src-bex/services/panel-presence';

const createTab = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', { tabs: { create: createTab } });
  for (const listener of lockListeners) listener();
  vi.clearAllMocks();
});

/** Remote-signer `auth_url` challenges, served to Porwr's own pages (#138). */
describe('remote-signer authorisation challenges', () => {
  it('are listed while their request waits, and the panel is told', async () => {
    const withdraw = addAuthChallenge({
      origin: 'https://site.example',
      accountPubkey: 'a'.repeat(64),
      url: 'https://signer.example/auth',
    });

    expect(notifyPanelsOfQueueChange).toHaveBeenCalledTimes(1);
    const listed = await handleNip46AuthChallenges();
    expect(listed).toEqual({
      success: true,
      data: [expect.objectContaining({ host: 'signer.example', origin: 'https://site.example' })],
    });

    withdraw();
    expect(notifyPanelsOfQueueChange).toHaveBeenCalledTimes(2);
    await expect(handleNip46AuthChallenges()).resolves.toEqual({ success: true, data: [] });
  });

  it('open the URL the background holds, by id, and nothing for an ended one', async () => {
    addAuthChallenge({ origin: '', accountPubkey: '', url: 'https://signer.example/auth' });
    const listed = await handleNip46AuthChallenges();
    const challenge = listed.success ? listed.data[0] : undefined;

    await expect(handleNip46OpenAuthChallenge({ challengeId: challenge!.id })).resolves.toEqual({
      success: true,
      data: true,
    });
    expect(createTab).toHaveBeenCalledWith({ url: 'https://signer.example/auth', active: true });

    await expect(handleNip46OpenAuthChallenge({ challengeId: 'unknown' })).resolves.toEqual({
      success: false,
      error: expect.any(String),
    });
    expect(createTab).toHaveBeenCalledTimes(1);
  });

  it('all end, and every remote-signer connection closes, when the vault locks', async () => {
    addAuthChallenge({ origin: '', accountPubkey: '', url: 'https://signer.example/auth' });

    for (const listener of lockListeners) listener();

    expect(close).toHaveBeenCalled();
    await expect(handleNip46AuthChallenges()).resolves.toEqual({ success: true, data: [] });
  });
});
