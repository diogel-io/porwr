import { describe, it, expect } from 'vitest';
import type { VaultData } from '@/types/bridge';
import {
  MAX_SAVED_PEERS,
  addSavedPeer,
  removeSavedPeer,
  savedPeersFor,
} from '@/../src-bex/services/messaging-saved-peers-store';

const ALICE = 'a'.repeat(64);
const CAROL = 'c'.repeat(64);
const BOB = 'b'.repeat(64);
const DAVE = 'd'.repeat(64);

const vault = (saved?: Record<string, string[]>): VaultData =>
  saved ? { accounts: [], messagingSavedPeers: saved } : { accounts: [] };

describe('messaging saved peers (#258)', () => {
  it('reads one account’s peers, as a copy', () => {
    const data = vault({ [ALICE]: [BOB], [CAROL]: [DAVE] });
    const peers = savedPeersFor(data, ALICE);

    peers.push(DAVE);

    expect(savedPeersFor(data, ALICE)).toEqual([BOB]);
    expect(savedPeersFor(vault(), ALICE)).toEqual([]);
  });

  it('adds to the end, for that account only', () => {
    const next = addSavedPeer(addSavedPeer(vault(), ALICE, BOB), ALICE, DAVE);

    expect(next.messagingSavedPeers).toEqual({ [ALICE]: [BOB, DAVE] });
  });

  it('returns the same vault when the peer is already saved, so nothing is written', () => {
    const data = vault({ [ALICE]: [BOB] });

    expect(addSavedPeer(data, ALICE, BOB)).toBe(data);
  });

  it('refuses to grow past the limit', () => {
    const full = Array.from({ length: MAX_SAVED_PEERS }, (_, index) =>
      index.toString(16).padStart(64, '0'),
    );

    expect(() => addSavedPeer(vault({ [ALICE]: full }), ALICE, BOB)).toThrow();
  });

  it('removes a peer, and returns the same vault when it was not saved', () => {
    const data = vault({ [ALICE]: [BOB, DAVE], [CAROL]: [BOB] });

    expect(removeSavedPeer(data, ALICE, BOB).messagingSavedPeers).toEqual({
      [ALICE]: [DAVE],
      [CAROL]: [BOB],
    });
    expect(removeSavedPeer(data, ALICE, CAROL)).toBe(data);
  });
});
