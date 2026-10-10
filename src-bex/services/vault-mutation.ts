import type { VaultData } from '@/types/bridge';
import { getVaultData, updateVaultData } from '../vault';

/**
 * Read-modify-write of the decrypted vault, one at a time.
 *
 * Every change runs here, inside the background, so a page never has to read the whole vault and
 * write it back (#240). Serialised so two quick changes cannot each read the old vault and lose the
 * other's update.
 */

let queue: Promise<void> = Promise.resolve();

export async function readVault(): Promise<VaultData> {
  const result = await getVaultData();
  if (!result.success || !result.vaultData) {
    throw new Error(result.error || 'Vault is locked');
  }
  return result.vaultData as VaultData;
}

export function mutateVault<T>(change: (vault: VaultData) => { vault: VaultData; result: T } | Promise<{ vault: VaultData; result: T }>): Promise<T> {
  const run = async (): Promise<T> => {
    const { vault, result } = await change(await readVault());
    const saved = await updateVaultData(vault);
    if (!saved.success) throw new Error(saved.error || 'Failed to save the vault');
    return result;
  };
  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
