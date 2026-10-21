import type { EncryptedKeyExport } from '@/types/accounts';

/**
 * The text of an exported key file (#141).
 *
 * It holds a NIP-49 `ncryptsec`, the private key encrypted with the export password (scrypt and
 * XChaCha20-Poly1305), and the public key it belongs to. No plaintext key, and no account alias:
 * the file says what it is, not whose it is. Any NIP-49 client, Porwr included, imports the
 * `ncryptsec` with the password.
 */
export function formatEncryptedKeyBackup({ ncryptsec, npub }: EncryptedKeyExport): string {
  return [
    'PORWR KEY BACKUP (NIP-49)',
    '',
    `Public key: ${npub}`,
    '',
    'Encrypted private key:',
    ncryptsec,
    '',
    'The private key above is encrypted with the password you chose when exporting it.',
    'To restore it, import the ncryptsec line into Porwr (Keys > Import) or any Nostr client',
    'that supports NIP-49, and enter that password. Without the password it cannot be read.',
    '',
  ].join('\n');
}
