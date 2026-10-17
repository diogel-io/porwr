import type { VaultData } from '@/types/bridge';
import { assignUnownedWalletData } from './nip47-ownership';
import { mutateVault } from './vault-mutation';

/**
 * Runs a wallet change on the shared vault queue, after giving pre-#304 data an owner.
 *
 * One queue for the whole vault, not one for wallets: removing an account now deletes its wallets,
 * and two queues writing the same vault could each read the old one and lose the other's change.
 * The migration rides along with every change and costs nothing once done, since an unchanged
 * vault is not written back.
 */
export async function mutateWalletVault<T>(
  mutator: (
    vaultData: VaultData,
  ) => { vaultData: VaultData; data: T } | Promise<{ vaultData: VaultData; data: T }>,
): Promise<T> {
  return mutateVault(async (vault) => {
    const { vaultData, data } = await mutator(assignUnownedWalletData(vault));
    return { vault: vaultData, result: data };
  });
}

/** The vault for a wallet read, migrated (and saved, the one time that changes anything) first. */
export async function readWalletVault(): Promise<VaultData> {
  return mutateWalletVault((vaultData) => ({ vaultData, data: vaultData }));
}
