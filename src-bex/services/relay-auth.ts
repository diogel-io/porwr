import { finalizeEvent } from 'nostr-tools';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools';

/** NIP-42 authentication event kind. Nothing else is ever signed for a relay's AUTH challenge. */
const AUTH_KIND = 22242;

/**
 * Signs a relay's NIP-42 challenge with `secretKey`, and refuses to sign anything else.
 *
 * nostr-tools hands this whatever template the relay's challenge produced; checking the kind means a
 * relay cannot turn an AUTH round trip into a signature over some other event.
 *
 * A connection authenticated this way belongs to one account. Never share it with another: a relay
 * would see both identities on one connection.
 */
export function authSigner(secretKey: Uint8Array) {
  return (template: EventTemplate): Promise<VerifiedEvent> => {
    if (template.kind !== AUTH_KIND) {
      return Promise.reject(new Error(`Refusing to sign kind ${template.kind} for relay AUTH`));
    }
    return Promise.resolve(finalizeEvent(template, secretKey));
  };
}
