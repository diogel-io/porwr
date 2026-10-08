import { generateSecretKey, getPublicKey } from 'nostr-tools';
import type { Account, StoredKey } from '@/types';
import { bytesToHex } from '@noble/hashes/utils';

export function generateKey(): StoredKey {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  const account: Account = {
    privkey: bytesToHex(sk),
  };
  return {
    id: pk,
    alias: '',
    account: account,
    createdAt: new Date().toISOString(),
  };
}
