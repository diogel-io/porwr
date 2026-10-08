import { describe, it, expect } from 'vitest';

import { markConversationRead, readStateFor } from '@/../src-bex/services/messaging-read-state-store';
import type { VaultData } from '@/types/bridge';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const base: VaultData = { accounts: [] };

describe('messaging read state', () => {
  it('is empty for an account that has read nothing', () => {
    expect(readStateFor(base, ME)).toEqual({});
  });

  it('records a read conversation per account, leaving the rest of the vault alone', () => {
    const next = markConversationRead({ ...base, nip57ZapHistory: [] }, ME, PEER, 100);

    expect(readStateFor(next, ME)).toEqual({ [PEER]: 100 });
    expect(readStateFor(next, 'c'.repeat(64))).toEqual({});
    expect(next.nip57ZapHistory).toEqual([]);
  });

  it('never moves a conversation backwards', () => {
    const read = markConversationRead(base, ME, PEER, 100);

    expect(markConversationRead(read, ME, PEER, 50)).toBe(read);
    expect(readStateFor(markConversationRead(read, ME, PEER, 150), ME)).toEqual({ [PEER]: 150 });
  });

  it('returns a copy, so callers cannot change the vault through it', () => {
    const read = markConversationRead(base, ME, PEER, 100);
    readStateFor(read, ME)[PEER] = 0;

    expect(readStateFor(read, ME)).toEqual({ [PEER]: 100 });
  });
});
