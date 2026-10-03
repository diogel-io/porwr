import { describe, it, expect } from 'vitest';

import {
  ORIGIN_SCOPED_ACTIONS,
  decideRouting,
} from 'app/src-bex/services/message-routing';

/**
 * An action scoped to an origin must never be dispatched without one.
 *
 * `checkPermission` and every signing handler key on the origin, so an empty one would be a request
 * from nowhere answered as though it came from somewhere (#173).
 */
describe('routing a raw runtime message', () => {
  describe('origin-scoped actions', () => {
    it('refuses one with no origin', () => {
      const decision = decideRouting({ type: 'nostr.signEvent', payload: {} });

      expect(decision).toEqual({
        dispatch: false,
        error: 'Missing origin for origin-scoped action',
      });
    });

    it('refuses one with no payload at all', () => {
      expect(decideRouting({ type: 'nostr.signEvent' }).dispatch).toBe(false);
    });

    it('refuses one whose origin is not a string', () => {
      // A non-string origin is the same failure as a missing one, and collapsing both here means
      // the dispatcher never has to wonder.
      expect(decideRouting({ type: 'nostr.signEvent', payload: { origin: 42 } }).dispatch).toBe(
        false,
      );
      expect(decideRouting({ type: 'nostr.signEvent', payload: { origin: null } }).dispatch).toBe(
        false,
      );
    });

    it('refuses one whose origin is empty', () => {
      expect(decideRouting({ type: 'nostr.signEvent', payload: { origin: '' } }).dispatch).toBe(
        false,
      );
    });

    it('dispatches one that carries an origin', () => {
      const decision = decideRouting({
        type: 'nostr.signEvent',
        payload: { origin: 'https://example.com', event: { kind: 1 } },
      });

      expect(decision).toEqual({
        dispatch: true,
        type: 'nostr.signEvent',
        payload: { origin: 'https://example.com', event: { kind: 1 } },
        origin: 'https://example.com',
      });
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
      const decision = decideRouting({ type: 'vault.lock', payload: {} });

      expect(decision.dispatch).toBe(true);
      if (decision.dispatch) expect(decision.origin).toBe('');
    });

    it('normalises a missing payload to an empty object', () => {
      const decision = decideRouting({ type: 'vault.lock' });

      expect(decision.dispatch).toBe(true);
      if (decision.dispatch) expect(decision.payload).toEqual({});
    });

    it('normalises a missing type to an empty string rather than throwing', () => {
      // An unknown action reaches the dispatcher and falls through its switch, which is where
      // "we do not serve that" belongs.
      const decision = decideRouting({});

      expect(decision.dispatch).toBe(true);
      if (decision.dispatch) expect(decision.type).toBe('');
    });
  });
});
