/**
 * Remote-signer authorisation challenges waiting for the user (diogel-io/workspace#138, T39).
 *
 * A NIP-46 signer may answer a request with `auth_url`: the user must authorise this client at
 * that URL before it signs. This happens after Porwr's own approval, while the request waits on the
 * signer. The challenge is put in front of the user on Porwr's panel as text, and the URL opens only
 * when the user clicks it there. Nothing opens by itself, and nothing at the URL is fetched to
 * present it, so the approval rule against remote lookups holds (D13).
 *
 * Challenges live in service-worker memory only, never in `chrome.storage.session`, and end with the
 * request they belong to.
 */

import type { Nip46AuthChallengeView } from '@/types/nip46';
import { notifyPanelsOfQueueChange } from './panel-presence';

/** A challenge as the panel sees it. The URL is `https:` and was checked by the NIP-46 client. */
export type Nip46AuthChallenge = Nip46AuthChallengeView;

const challenges = new Map<string, Nip46AuthChallenge>();
let nextId = 0;

/** Show a challenge on the panel. Returns a function that withdraws it. */
export function addAuthChallenge(challenge: Omit<Nip46AuthChallenge, 'id' | 'host'>): () => void {
  nextId += 1;
  const id = `nip46-auth-${nextId}`;
  challenges.set(id, { ...challenge, id, host: new URL(challenge.url).host });
  notifyPanelsOfQueueChange();
  return () => {
    if (challenges.delete(id)) notifyPanelsOfQueueChange();
  };
}

export function listAuthChallenges(): Nip46AuthChallenge[] {
  return [...challenges.values()];
}

/** The URL of a challenge still waiting, for opening it on the user's click. */
export function authChallengeUrl(id: unknown): string | null {
  return typeof id === 'string' ? (challenges.get(id)?.url ?? null) : null;
}

export function clearAuthChallenges(): void {
  if (challenges.size === 0) return;
  challenges.clear();
  notifyPanelsOfQueueChange();
}
