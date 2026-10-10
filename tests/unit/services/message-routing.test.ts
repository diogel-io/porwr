import { describe, it, expect } from 'vitest';

import {
  ORIGIN_SCOPED_ACTIONS,
  decideRouting,
} from '@/../src-bex/services/message-routing';
import type { SenderClass } from '@/../src-bex/services/sender-policy';

const PAGE: SenderClass = 'extension-page';

/**
 * An action scoped to an origin must never be dispatched without one.
 *
 * `checkPermission` and every signing handler key on the origin, so an empty one would be a request
 * from nowhere answered as though it came from somewhere (#173).
 */
describe('routing a raw runtime message', () => {
  describe('origin-scoped actions', () => {
    it('refuses one with no origin', () => {
      const decision = decideRouting({ type: 'nostr.signEvent', payload: {} }, PAGE);

      expect(decision).toEqual({
        dispatch: false,
        error: 'Missing origin for origin-scoped action',
      });
    });

    it('refuses one with no payload at all', () => {
      expect(decideRouting({ type: 'nostr.signEvent' }, PAGE).dispatch).toBe(false);
    });

    it('refuses one whose origin is not a string', () => {
      // A non-string origin is the same failure as a missing one, and collapsing both here means
      // the dispatcher never has to wonder.
      expect(decideRouting({ type: 'nostr.signEvent', payload: { origin: 42 } }, PAGE).dispatch).toBe(
        false,
      );
      expect(decideRouting({ type: 'nostr.signEvent', payload: { origin: null } }, PAGE).dispatch).toBe(
        false,
      );
    });

    it('refuses one whose origin is empty', () => {
      expect(decideRouting({ type: 'nostr.signEvent', payload: { origin: '' } }, PAGE).dispatch).toBe(
        false,
      );
    });

    it('refuses one from an extension page even when it names an origin (#240)', () => {
      // Sites reach these over the bridge, through the content script, which supplies the origin.
      // A page naming a site's origin here would borrow that site's grants.
      const decision = decideRouting({
        type: 'nostr.signEvent',
        payload: { origin: 'https://example.com', event: { kind: 1 } },
      }, PAGE);

      expect(decision).toEqual({
        dispatch: false,
        error: 'Origin-scoped actions are not accepted from extension pages',
      });
    });

    it('refuses every origin-scoped action from an extension page', () => {
      for (const action of ORIGIN_SCOPED_ACTIONS) {
        expect(decideRouting({ type: action, payload: { origin: 'https://example.com' } }, PAGE).dispatch).toBe(false);
      }
    });

    it('covers every action that acts on a site’s behalf', () => {
      // Signing, encryption, decryption, payment and identity disclosure. If one is added to the
      // provider and not to this set, it would dispatch with an empty origin.
      for (const action of [
        'nostr.getPublicKey',
        'nostr.signEvent',
        'nostr.nip04.encrypt',
        'nostr.nip04.decrypt',
        'nostr.nip44.encrypt',
        'nostr.nip44.decrypt',
        'nip57.sendZap',
        'webln.sendPayment',
      ]) {
        expect(ORIGIN_SCOPED_ACTIONS.has(action)).toBe(true);
      }
    });
  });

  describe('everything else', () => {
    it('never treats the site-account messages as a site acting for itself', () => {
      // Moving a site to another account is the user's decision, made in Porwr's own UI. A site
      // that could send it would choose its own identity (diogel-io/workspace#23).
      expect(ORIGIN_SCOPED_ACTIONS.has('sites.binding')).toBe(false);
      expect(ORIGIN_SCOPED_ACTIONS.has('sites.useActiveAccount')).toBe(false);
    });

    it('dispatches an extension-surface action with no origin', () => {
      // Panel and vault actions come from Porwr's own surfaces, which have no site origin to give.
      const decision = decideRouting({ type: 'vault.lock', payload: {} }, PAGE);

      expect(decision.dispatch).toBe(true);
      if (decision.dispatch) expect(decision.origin).toBe('');
    });

    it('normalises a missing payload to an empty object', () => {
      const decision = decideRouting({ type: 'vault.lock' }, PAGE);

      expect(decision.dispatch).toBe(true);
      if (decision.dispatch) expect(decision.payload).toEqual({});
    });

    it('normalises a missing type to an empty string rather than throwing', () => {
      // An unknown action reaches the dispatcher and falls through its switch, which is where
      // "we do not serve that" belongs.
      const decision = decideRouting({}, PAGE);

      expect(decision.dispatch).toBe(true);
      if (decision.dispatch) expect(decision.type).toBe('');
    });
  });

  describe('who sent it (#240)', () => {
    const senders: SenderClass[] = ['content-script', 'foreign'];

    it.each(senders)('refuses anything from a %s, whatever it asks for', (sender) => {
      for (const message of [
        { type: 'vault.getData', payload: {} },
        { type: 'vault.updateData', payload: { vaultData: { accounts: [] } } },
        { type: 'nostr.requests.respond', payload: { requestId: 'r', decision: 'approve' } },
        { type: 'sites.revoke', payload: { origin: 'https://example.com' } },
        { type: 'nostr.signEvent', payload: { origin: 'https://example.com' } },
        { type: 'ping' },
        {},
      ]) {
        expect(decideRouting(message, sender)).toEqual({ dispatch: false, error: 'Untrusted sender' });
      }
    });

    it("dispatches a Porwr page's vault and queue actions", () => {
      for (const type of ['vault.getData', 'vault.lock', 'nostr.requests.respond', 'sites.revoke', 'messaging.fetch']) {
        expect(decideRouting({ type, payload: {} }, PAGE).dispatch).toBe(true);
      }
    });
  });
});
