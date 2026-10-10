import { BlobWriter, configure, TextReader, ZipWriter } from '@zip.js/zip.js';
import type { AccountSummary } from '@/types/accounts';
import * as nip19 from 'nostr-tools/nip19';

export const ZIP_MIME_TYPE = 'application/zip';
// This required here to disable web workers for @zip.js
// couldn't figure out how to instantiate this in the quasar.config
configure({
  useWebWorkers: false,
});

/**
 * The password-protected backup the user asked to export. `nsec` comes from the background's
 * explicit reveal for this one export (#240); the page never reads it from the account.
 */
export async function createEncryptedZipBytes(
  password: string,
  filename: string,
  key: AccountSummary,
  nsec: string,
): Promise<ArrayBuffer> {
  const writer = new ZipWriter(new BlobWriter(ZIP_MIME_TYPE), {
    password,
    zipCrypto: true, // enables encryption
  });

  const content = generateKeyExportText(key, nsec);
  await writer.add(`${key.alias}.txt`, new TextReader(content));

  const zipBlob = await writer.close();
  return await zipBlob.arrayBuffer();
}



/**
 * Check if a string is a valid hexadecimal string
 */
function isValidHex(str: string): boolean {
  return /^[0-9a-fA-F]+$/.test(str);
}

/**
 * Generates the text content for the exported key file.
 * This is exported for testing purposes.
 * @param key The stored key to export
 * @returns The text content for the export file
 */
function generateKeyExportText(key: AccountSummary, revealedNsec: string): string {
  if (!key) {
    throw new Error('Stored key cannot be null or undefined');
  }

  let npub = 'Error (Invalid ID)';
  let nsec = 'Error (Invalid Private Key)';

  try {
    if (isValidHex(key.id)) {
      npub = nip19.npubEncode(key.id);
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    npub = 'Error encoding npub';
  }

  if (revealedNsec.startsWith('nsec1')) {
    nsec = revealedNsec;
  }

  return formatKeyBackupText(key.alias, key.createdAt, npub, nsec);
}

export default generateKeyExportText
export function formatKeyBackupText(
  alias: string,
  createdAt: string,
  npub: string,
  nsec: string,
): string {
  const lines = [
    '===================================================================================',
    '                          DIOGEL KEY BACKUP',
    '===================================================================================',
    '',
    `Alias: ${alias}`,
    `Created At: ${createdAt}`,
    '',
    '-----------------------------------------------------------------------------------',
    'NOSTR KEYS',
    '-----------------------------------------------------------------------------------',
    `npub (Public Key):  ${npub}`,
    `nsec (Private Key): ${nsec}`,
    '',
    '-----------------------------------------------------------------------------------',
    'IMPORTANT SECURITY NOTES',
    '-----------------------------------------------------------------------------------',
    '- KEEP THIS FILE SECURE: This file contains your sensitive private key.',
    '- DO NOT SHARE: Anyone with access to this file can control your Nostr identity.',
    '- DO NOT LEAVE IN PLAIN TEXT: Once decrypted, ensure this file is not left on',
    '  an unencrypted drive.',
    '- DO NOT UPLOAD: Never upload this file to any public or cloud storage.',
    '- DO NOT EMAIL: Email is not a secure medium for private keys.',
    '',
    '===================================================================================',
    'DIOGEL - Secure Nostr Key Management',
    '====================================================================================',
  ];

  return lines.join('\n') + '\n';
}
