import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import * as nip49 from 'nostr-tools/nip49';
import { bech32 } from '@scure/base';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { db } from '@/services/database';
import { clearAccount as clearContactCache } from '@/services/contact-cache';
import { NOSTR_ACTIVE, storageService } from '@/services/storage-service';
import type { StoredKey, VaultData } from '@/types/bridge';
import type {
  AccountRequest,
  AccountSummary,
  AddAccountRequest,
  AddRemoteAccountRequest,
  EncryptedKeyExport,
  ExportEncryptedRequest,
  ImportEncryptedRequest,
  RenameAccountRequest,
  RevealedSecret,
  RevealSecretRequest,
  VaultView,
} from '@/types/accounts';
import { MAIN_ACCOUNT_ALIAS, MIN_PASSWORD_LENGTH } from '@/types/accounts';
import { verifyVaultPassword } from '../vault';
import { createPubkey } from '@/types/pubkey';
import type { HandlerResult } from '../types/background';
import { mutateVault, readVault } from '../services/vault-mutation';
import { removeAccountWalletData } from '../services/nip47-connection-store';
import { assignUnownedWalletData } from '../services/nip47-ownership';
import { interruptRequestsForAccount } from '../services/request-queue';
import { sweepSiteStateForRemovedAccounts } from '../services/connected-sites';
import { accountPubkeyOf, isRemoteAccount, localSecretKeyOf } from '../services/account-key';
import { allowedSignerRelays, nip46Client } from '../services/nip46-client';
import { authChallengeSlot } from '../services/nip46-auth-challenges';
import { parseBunkerUri } from '@/services/nip46-uri';
import type { RemoteSignerConnection } from '@/types';

/**
 * Accounts, for Porwr's own pages (#240).
 *
 * Pages used to read the whole decrypted vault, edit it, and write it all back. Now they read a view
 * with no secrets in it and ask for one change at a time; the background makes the change to the
 * decrypted vault itself. The raw listener only accepts these from extension pages.
 */

const HEX_64 = /^[0-9a-f]{64}$/;

export const summarise = (account: StoredKey): AccountSummary => ({
  id: account.id,
  alias: account.alias,
  createdAt: account.createdAt,
  ...(isRemoteAccount(account)
    ? {
        kind: 'remote' as const,
        remoteSigner: {
          pubkey: account.account.nip46.remoteSignerPubkey,
          relays: [...account.account.nip46.relays],
        },
      }
    : {}),
});

/** The vault as a page may see it: accounts by id, alias and creation date, and nothing secret. */
export const viewOf = (vault: VaultData): VaultView => ({
  accounts: (vault.accounts ?? []).map(summarise),
});

/**
 * The account that acts as `pubkey`: a local account matched on the key itself rather than the
 * stored id, or a remote-signer account on the key its signer reported (#138).
 */
const findByKey = (vault: VaultData, pubkey: string): StoredKey | undefined =>
  (vault.accounts ?? []).find((account) => accountPubkeyOf(account) === pubkey);

const checkAlias = (vault: VaultData, alias: unknown, ignore?: string): string => {
  const trimmed = typeof alias === 'string' ? alias.trim() : '';
  if (!trimmed) throw new Error('Alias is required.');
  if (trimmed === MAIN_ACCOUNT_ALIAS) throw new Error(`Alias "${MAIN_ACCOUNT_ALIAS}" is reserved.`);
  if (
    (vault.accounts ?? []).some((account) => account.alias === trimmed && account.alias !== ignore)
  ) {
    throw new Error('Key with the same alias already exists.');
  }
  return trimmed;
};

const fail = (error: unknown): { success: false; error: string } => ({
  success: false,
  error: error instanceof Error ? error.message : String(error),
});

export async function handleVaultGetView(): Promise<HandlerResult<VaultView>> {
  return { success: true, data: viewOf(await readVault()) };
}

export async function handleAccountsAdd(
  payload: AddAccountRequest,
): Promise<HandlerResult<AccountSummary>> {
  let secretKey: Uint8Array;
  if (payload?.privkey === undefined) {
    secretKey = generateSecretKey();
  } else if (typeof payload.privkey === 'string' && HEX_64.test(payload.privkey)) {
    secretKey = hexToBytes(payload.privkey);
  } else {
    return { success: false, error: 'privkey must be a 64-character hex key' };
  }
  const pubkey = getPublicKey(secretKey);

  try {
    const added = await mutateVault((vault) => {
      const alias = checkAlias(vault, payload?.alias);
      if (findByKey(vault, pubkey)) throw new Error('Key with the same npub already exists.');

      const account: StoredKey = {
        id: pubkey,
        alias,
        account: { privkey: bytesToHex(secretKey) },
        createdAt: new Date().toISOString(),
      };
      return {
        vault: { ...vault, accounts: [...(vault.accounts ?? []), account] },
        result: summarise(account),
      };
    });
    return { success: true, data: added };
  } catch (error: unknown) {
    return fail(error);
  }
}

const CONNECTION_NOT_ACCEPTED = 'The remote signer did not accept the connection';
const NO_VALID_USER_KEY = 'The remote signer did not report a valid public key';
const LOCKED_WHILE_CONNECTING =
  'The vault was locked while the remote signer was being connected. Nothing was saved.';

/** `switch_relays` is optional, so a signer that does not answer quickly keeps its URI's relays. */
const SWITCH_RELAYS_TIMEOUT_MS = 5000;

/**
 * The relays the signer asks the client to use from now on, kept only when Porwr may connect to
 * them (NIP-46 §switch_relays). Any failure, or a `null` answer, keeps the current relays.
 */
async function switchedRelays(connection: RemoteSignerConnection): Promise<string[]> {
  try {
    const result = await nip46Client.request(connection, 'switch_relays', [], {
      timeoutMs: SWITCH_RELAYS_TIMEOUT_MS,
    });
    const relays = JSON.parse(result) as unknown;
    if (!Array.isArray(relays) || !relays.every((relay) => typeof relay === 'string')) {
      return connection.relays;
    }
    return allowedSignerRelays({ relays });
  } catch {
    return connection.relays;
  }
}

/**
 * Connect an account held by a NIP-46 remote signer (#138).
 *
 * The background makes the client key itself and keeps it in the vault, with the signer's key, its
 * relays and the URI's secret; no private key for the account is stored. The user's public key is
 * the one the signer reports after `connect`, never the key in the URI. Nothing is saved unless the
 * signer accepts the connection and reports a valid key that is not already in the vault.
 */
export async function handleAccountsAddRemote(
  payload: AddRemoteAccountRequest,
): Promise<HandlerResult<AccountSummary>> {
  try {
    const parsed = parseBunkerUri(payload?.bunkerUri);
    // Checked before anything is sent, so a taken alias costs no round trip to the signer.
    checkAlias(await readVault(), payload?.alias);

    // A lock while the signer is being asked must stop the save, as it does for a wallet (#85).
    const locksBefore = nip46Client.lockGeneration;
    let connection: RemoteSignerConnection = {
      remoteSignerPubkey: parsed.remoteSignerPubkey,
      relays: parsed.relays,
      clientSecret: bytesToHex(generateSecretKey()),
      ...(parsed.secret !== undefined ? { connectSecret: parsed.secret } : {}),
    };

    // A signer may ask the user to authorise the client first; the form and the panel show it.
    const challenge = authChallengeSlot({ origin: '', accountPubkey: '' });
    const onAuthUrl = challenge.show;
    let userPubkey: string;
    try {
      const ack = await nip46Client.request(
        connection,
        'connect',
        parsed.secret !== undefined
          ? [parsed.remoteSignerPubkey, parsed.secret]
          : [parsed.remoteSignerPubkey],
        { onAuthUrl },
      );
      if (ack !== 'ack' && !(parsed.secret !== undefined && ack === parsed.secret)) {
        return { success: false, error: CONNECTION_NOT_ACCEPTED };
      }
      userPubkey = (await nip46Client.request(connection, 'get_public_key', [], { onAuthUrl }))
        .trim()
        .toLowerCase();
    } finally {
      challenge.clear();
    }
    if (!HEX_64.test(userPubkey)) return { success: false, error: NO_VALID_USER_KEY };
    connection = { ...connection, relays: await switchedRelays(connection) };

    const added = await mutateVault((vault) => {
      // Checked inside the mutation, so the check and the write go together.
      if (nip46Client.lockGeneration !== locksBefore) throw new Error(LOCKED_WHILE_CONNECTING);
      const alias = checkAlias(vault, payload?.alias);
      if (findByKey(vault, userPubkey)) throw new Error('Key with the same npub already exists.');

      const account: StoredKey = {
        id: userPubkey,
        alias,
        account: { type: 'remote', nip46: connection },
        createdAt: new Date().toISOString(),
      };
      return {
        vault: { ...vault, accounts: [...(vault.accounts ?? []), account] },
        result: summarise(account),
      };
    });
    return { success: true, data: added };
  } catch (error: unknown) {
    return fail(error);
  }
}

export async function handleAccountsRename(
  payload: RenameAccountRequest,
): Promise<HandlerResult<AccountSummary>> {
  const currentAlias = typeof payload?.currentAlias === 'string' ? payload.currentAlias : '';
  try {
    const renamed = await mutateVault((vault) => {
      const target = (vault.accounts ?? []).find((account) => account.alias === currentAlias);
      if (!target) throw new Error('Key not found.');
      const newAlias = checkAlias(vault, payload?.newAlias, currentAlias);
      const accounts = (vault.accounts ?? []).map((account) =>
        account === target ? { ...account, alias: newAlias } : account,
      );
      return { vault: { ...vault, accounts }, result: summarise({ ...target, alias: newAlias }) };
    });

    if (renamed.alias !== currentAlias) {
      // History and the active account are keyed by alias, so they follow the rename.
      await db.approvals.where('account').equals(currentAlias).modify({ account: renamed.alias });
      await db.exceptions.where('account').equals(currentAlias).modify({ account: renamed.alias });
      if ((await storageService.get<string>(NOSTR_ACTIVE)) === currentAlias) {
        await storageService.set(NOSTR_ACTIVE, renamed.alias);
      }
    }
    return { success: true, data: renamed };
  } catch (error: unknown) {
    return fail(error);
  }
}

export async function handleAccountsRemove(
  payload: AccountRequest,
): Promise<HandlerResult<boolean>> {
  const pubkey = createPubkey(
    typeof payload?.accountPubkey === 'string' ? payload.accountPubkey : '',
  );
  if (!pubkey) return { success: false, error: 'accountPubkey must be a hex public key' };

  try {
    const removedId = await mutateVault((vault) => {
      const target =
        findByKey(vault, pubkey) ?? (vault.accounts ?? []).find((account) => account.id === pubkey);
      if (!target) return { vault, result: undefined };
      // Its wallets go with it, in the same write (#304): a connection with no account behind it
      // would otherwise be migrated to the main account on the next wallet action. Pre-#304 data is
      // given its owner first, so removing the main account removes the wallets it owned instead of
      // leaving them to be handed to whichever account is main next (#139).
      const withoutWallets = removeAccountWalletData(assignUnownedWalletData(vault), target.id);
      return {
        vault: {
          ...withoutWallets,
          accounts: (vault.accounts ?? []).filter((account) => account !== target),
        },
        result: target.id,
      };
    });
    if (removedId !== undefined) {
      // A request waiting on a decision for it can no longer be approved: approving would bind a
      // site to, and grant for, an account that no longer exists (#139).
      await interruptRequestsForAccount(removedId).catch(() => undefined);
      // Its sites must not sign as it again if the same key is imported later (#139). Best-effort:
      // the account is gone, signing as it already fails closed, and unlock sweeps again.
      await readVault()
        .then((vault) => sweepSiteStateForRemovedAccounts((vault.accounts ?? []).map((a) => a.id)))
        .catch(() => undefined);
      // Its cached contacts would otherwise outlive the account (#257). Best-effort: the account is gone.
      await clearContactCache(removedId).catch(() => undefined);
    }
    return { success: true, data: removedId !== undefined };
  } catch (error: unknown) {
    return fail(error);
  }
}

/**
 * One account's nsec, for the user's explicit "show private key".
 *
 * The only action that returns a private key to a page, and only to Porwr's own. The vault password
 * is asked for again first, so a moment at an unlocked browser is not enough to read a key (#141;
 * this replaces the no-re-authentication decision on #240). Export no longer uses it: an export is
 * encrypted here and the page receives only the `ncryptsec`.
 */
export async function handleAccountsRevealSecret(
  payload: RevealSecretRequest,
): Promise<HandlerResult<RevealedSecret>> {
  const pubkey = createPubkey(
    typeof payload?.accountPubkey === 'string' ? payload.accountPubkey : '',
  );
  if (!pubkey) return { success: false, error: 'accountPubkey must be a hex public key' };
  if (!(await verifyVaultPassword(payload?.password))) {
    return { success: false, error: 'Incorrect vault password' };
  }

  try {
    const account = findByKey(await readVault(), pubkey);
    if (!account) return { success: false, error: 'Account not found' };
    return { success: true, data: { nsec: nip19.nsecEncode(localSecretKeyOf(account)) } };
  } catch (error: unknown) {
    return fail(error);
  }
}

/**
 * One account's key, encrypted for export as a NIP-49 `ncryptsec` with a password chosen for the
 * export (#141). The key is encrypted here, so the page never receives the nsec. Any NIP-49 client,
 * Porwr included, can import the result with the same password.
 *
 * The vault password is checked first, as for showing a key: whoever chooses the export password
 * can decrypt the export, so exporting is as sensitive as showing.
 */
export async function handleAccountsExportEncrypted(
  payload: ExportEncryptedRequest,
): Promise<HandlerResult<EncryptedKeyExport>> {
  const pubkey = createPubkey(
    typeof payload?.accountPubkey === 'string' ? payload.accountPubkey : '',
  );
  if (!pubkey) return { success: false, error: 'accountPubkey must be a hex public key' };
  // NIP-49 derives the key from the NFKC-normalised password, so that is what is measured, in
  // characters rather than UTF-16 units: `'e\u0301'` four times is eight units but four characters.
  if (
    typeof payload?.password !== 'string' ||
    Array.from(payload.password.normalize('NFKC')).length < MIN_PASSWORD_LENGTH
  ) {
    return {
      success: false,
      error: `The export password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  if (!(await verifyVaultPassword(payload?.vaultPassword))) {
    return { success: false, error: 'Incorrect vault password' };
  }

  try {
    const account = findByKey(await readVault(), pubkey);
    if (!account) return { success: false, error: 'Account not found' };
    return {
      success: true,
      data: {
        ncryptsec: nip49.encrypt(localSecretKeyOf(account), payload.password),
        npub: nip19.npubEncode(account.id),
      },
    };
  } catch (error: unknown) {
    return fail(error);
  }
}

/**
 * The highest scrypt cost (`logn`) accepted for an imported `ncryptsec`: four times NIP-49's usual
 * 16, which Porwr's own exports use, at about 256 MiB. The cost is read from the key itself, so
 * without a cap a crafted key could make the background allocate 1 GiB and run scrypt for tens of
 * seconds, stalling every signing request while it does (#141).
 */
export const MAX_NCRYPTSEC_LOGN = 18;

/** NIP-49's limit on the Bech32 string, as `nostr-tools` uses it. */
const NCRYPTSEC_MAX_LENGTH = 5000;

/** The scrypt cost an `ncryptsec` asks for, or null when it is not a version 2 ncryptsec. */
export function ncryptsecCost(ncryptsec: string): number | null {
  try {
    const { prefix, words } = bech32.decode(
      ncryptsec as `${string}1${string}`,
      NCRYPTSEC_MAX_LENGTH,
    );
    if (prefix !== 'ncryptsec') return null;
    const bytes = bech32.fromWords(words);
    return bytes[0] === 0x02 && typeof bytes[1] === 'number' ? bytes[1] : null;
  } catch {
    return null;
  }
}

/**
 * Import a NIP-49 `ncryptsec`, decrypted here with its password, then added as any key is
 * (`handleAccountsAdd`). The decrypted key never reaches the page (#141).
 */
export async function handleAccountsImportEncrypted(
  payload: ImportEncryptedRequest,
): Promise<HandlerResult<AccountSummary>> {
  const ncryptsec = typeof payload?.ncryptsec === 'string' ? payload.ncryptsec.trim() : '';
  // All-uppercase Bech32 is valid too. The original string goes to the decoder, which still
  // refuses mixed case.
  if (!ncryptsec.toLowerCase().startsWith('ncryptsec1')) {
    return { success: false, error: 'Not an ncryptsec key' };
  }

  // Read before any scrypt runs, so a key asking for an excessive cost is refused at once.
  const cost = ncryptsecCost(ncryptsec);
  if (cost === null) {
    return { success: false, error: 'Incorrect password, or not a valid ncryptsec' };
  }
  if (cost > MAX_NCRYPTSEC_LOGN) {
    return {
      success: false,
      error: `This key is encrypted at a cost Porwr does not accept (${cost}, maximum ${MAX_NCRYPTSEC_LOGN})`,
    };
  }

  let secretKey: Uint8Array;
  try {
    secretKey = nip49.decrypt(
      ncryptsec,
      typeof payload?.password === 'string' ? payload.password : '',
    );
  } catch {
    return { success: false, error: 'Incorrect password, or not a valid ncryptsec' };
  }

  return handleAccountsAdd({ alias: payload?.alias, privkey: bytesToHex(secretKey) });
}
