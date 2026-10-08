import type { VaultData } from '@/types/bridge';
import type { WebLnMethod, WebLnPermissionGrant } from '@/types/webln';

function nowMs(): number {
  return Date.now();
}

export function listWebLnPermissions(vaultData?: VaultData | null): WebLnPermissionGrant[] {
  return vaultData?.webLnPermissions ?? [];
}

export function hasWebLnPermission(
  vaultData: VaultData,
  input: { origin: string; connectionId: string; method: WebLnMethod },
): boolean {
  const now = nowMs();
  return listWebLnPermissions(vaultData).some((grant) => {
    if (grant.origin !== input.origin || grant.connectionId !== input.connectionId) return false;
    if (!grant.methods.includes(input.method) && !grant.methods.includes('enable')) return false;
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= now) return false;
    return true;
  });
}

export function upsertWebLnPermission(
  vaultData: VaultData,
  grant: WebLnPermissionGrant,
): VaultData {
  const existing = listWebLnPermissions(vaultData).filter(
    (item) => !(item.origin === grant.origin && item.connectionId === grant.connectionId),
  );
  const methods = [...new Set(grant.methods)];
  return {
    ...vaultData,
    webLnPermissions: [
      ...existing,
      {
        ...grant,
        methods,
      },
    ],
  };
}
