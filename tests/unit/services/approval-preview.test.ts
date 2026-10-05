import { describe, it, expect } from 'vitest';

import {
  classifyRequest,
  ELEVATED_EVENT_KINDS,
  formatEventFields,
  getAllowedDurations,
  getEventKindLabel,
  getRequestTypeLabel,
  getRiskWarning,
  HTTP_AUTH_KIND,
  httpAuthOtherOrigin,
  httpAuthTarget,
  shouldDefaultToFullEvent,
  truncateForPreview,
} from 'src/services/approval-preview';

describe('approval preview rules', () => {
  describe('classification (D12)', () => {
    it('treats known ordinary kinds as standard', () => {
      expect(classifyRequest('sign_event', 1)).toBe('standard');
      expect(classifyRequest('sign_event', 7)).toBe('standard');
    });

    it('treats the elevated kinds as elevated', () => {
      for (const kind of ELEVATED_EVENT_KINDS) {
        expect(classifyRequest('sign_event', kind)).toBe('elevated');
      }
    });

    it('treats an unrecognised kind as unknown', () => {
      expect(classifyRequest('sign_event', 31337)).toBe('unknown');
    });

    it('treats payment requests as payments whatever their kind', () => {
      expect(classifyRequest('webln_send_payment', -1)).toBe('payment');
      expect(classifyRequest('send_zap', 9734)).toBe('payment');
    });

    it('does not treat the no-kind sentinel as an unknown kind', () => {
      // -1 means "this request has no event kind", not "any kind" and not "unrecognised".
      expect(classifyRequest('get_public_key', -1)).toBe('standard');
    });
  });

  describe('grant options (D11, D12)', () => {
    it('offers all three durations for a standard request', () => {
      expect(getAllowedDurations('standard', true)).toEqual(['once', '8h', 'always']);
    });

    it('never offers always for an elevated kind', () => {
      expect(getAllowedDurations('elevated', true)).toEqual(['once', '8h']);
    });

    it('offers only once for an unknown kind', () => {
      expect(getAllowedDurations('unknown', true)).toEqual(['once']);
    });

    it('offers only once for a payment, even when remembering is allowed', () => {
      expect(getAllowedDurations('payment', true)).toEqual(['once']);
    });

    it('offers only once when the request forbids remembering', () => {
      expect(getAllowedDurations('standard', false)).toEqual(['once']);
    });
  });

  describe('warnings', () => {
    it('names the specific effect for an elevated kind', () => {
      expect(getRiskWarning('elevated', 5)).toContain('deletion');
      expect(getRiskWarning('elevated', 3)).toContain('follow');
      expect(getRiskWarning('elevated', 22242)).toContain('identity');
    });

    it('tells the user to read the full event for an unknown kind', () => {
      expect(getRiskWarning('unknown', 31337)).toContain('full event');
    });

    it('says nothing for a standard request', () => {
      expect(getRiskWarning('standard', 1)).toBeUndefined();
    });

    it('opens on the full event only for unknown kinds', () => {
      expect(shouldDefaultToFullEvent('unknown')).toBe(true);
      expect(shouldDefaultToFullEvent('standard')).toBe(false);
      expect(shouldDefaultToFullEvent('elevated')).toBe(false);
    });
  });

  describe('labels', () => {
    it('labels known request types and falls back safely', () => {
      expect(getRequestTypeLabel('sign_event')).toBe('Sign event request');
      expect(getRequestTypeLabel('something_new')).toBe('Signer request');
    });

    it('marks an unrecognised kind as unrecognised rather than inventing a name', () => {
      expect(getEventKindLabel(1)).toBe('Text note (1)');
      expect(getEventKindLabel(31337)).toContain('Unrecognised');
      expect(getEventKindLabel(-1)).toBe('No Nostr event kind');
    });
  });

  describe('truncation', () => {
    it('leaves short content alone', () => {
      const result = truncateForPreview('short');
      expect(result).toEqual({ text: 'short', truncated: false, fullLength: 5 });
    });

    it('reports truncation rather than hiding it', () => {
      const content = 'x'.repeat(700);
      const result = truncateForPreview(content);
      expect(result.truncated).toBe(true);
      expect(result.fullLength).toBe(700);
      expect(result.text).toHaveLength(600);
    });
  });

  describe('formatted fields', () => {
    it('summarises the meaningful fields without exposing raw content', () => {
      const fields = formatEventFields({
        kind: 1,
        content: 'hello world',
        created_at: 1_700_000_000,
        tags: [
          ['p', 'abc'],
          ['e', 'def'],
        ],
      });

      const labels = fields.map((field) => field.label);
      expect(labels).toContain('Kind');
      expect(labels).toContain('Mentions');
      expect(labels).toContain('References events');
      expect(JSON.stringify(fields)).not.toContain('hello world');
    });
  });

  // NIP-98: Bancwr signs its users in with one, bound to its login URL (#215).
  describe('HTTP authentication (kind 27235)', () => {
    const httpAuth = (tags: string[][]) => ({
      kind: HTTP_AUTH_KIND,
      content: '',
      created_at: 1_700_000_000,
      tags,
    });
    const login = httpAuth([
      ['u', 'https://bancwr.example/api/auth/login'],
      ['method', 'post'],
    ]);

    it('is recognised, labelled and elevated, so it is never an unrecognised kind', () => {
      expect(getEventKindLabel(27235)).toBe('HTTP authentication (27235)');
      expect(classifyRequest('sign_event', 27235)).toBe('elevated');
      expect(getRiskWarning('elevated', 27235)).toBe(
        "Approving this lets the site prove your identity to this site's server.",
      );
      expect(shouldDefaultToFullEvent('elevated')).toBe(false);
    });

    it('is never offered always, as an elevated kind', () => {
      expect(getAllowedDurations(classifyRequest('sign_event', 27235), true)).toEqual([
        'once',
        '8h',
      ]);
    });

    it('shows the URL and method it authorises, the method upper-cased', () => {
      const fields = formatEventFields(login);
      expect(fields).toContainEqual({ label: 'URL', value: 'https://bancwr.example/api/auth/login' });
      expect(fields).toContainEqual({ label: 'Method', value: 'POST' });
    });

    it('says a missing URL or method is missing rather than leaving it out', () => {
      const fields = formatEventFields(httpAuth([['u', 'https://bancwr.example/login']]));
      expect(fields).toContainEqual({
        label: 'Method',
        value: 'Missing (not a valid HTTP authentication event)',
      });
    });

    it('adds no URL or method to other kinds', () => {
      const labels = formatEventFields({ ...login, kind: 1 }).map((field) => field.label);
      expect(labels).not.toContain('URL');
      expect(labels).not.toContain('Method');
    });

    it('reads the target, or why there is none', () => {
      expect(httpAuthTarget(login)).toEqual({
        valid: true,
        url: 'https://bancwr.example/api/auth/login',
        method: 'POST',
        origin: 'https://bancwr.example',
      });
      expect(httpAuthTarget(httpAuth([['method', 'GET']]))).toEqual({
        valid: false,
        reason: 'missing-url',
      });
      expect(httpAuthTarget(httpAuth([['u', 'https://a.example']]))).toEqual({
        valid: false,
        reason: 'missing-method',
      });
      expect(
        httpAuthTarget(httpAuth([
          ['u', 'not a url'],
          ['method', 'GET'],
        ])),
      ).toEqual({ valid: false, reason: 'invalid-url' });
    });

    it('names the other server only when the site asks for access somewhere else', () => {
      expect(httpAuthOtherOrigin(login, 'https://bancwr.example')).toBeUndefined();
      // A trailing path or slash on the requesting origin is still the same site.
      expect(httpAuthOtherOrigin(login, 'https://bancwr.example/')).toBeUndefined();
      expect(httpAuthOtherOrigin(login, 'https://evil.example')).toBe('https://bancwr.example');
      // Another port is another origin.
      expect(httpAuthOtherOrigin(login, 'https://bancwr.example:8443')).toBe(
        'https://bancwr.example',
      );
    });

    it('raises nothing for other kinds, malformed events or no event', () => {
      expect(httpAuthOtherOrigin({ ...login, kind: 1 }, 'https://evil.example')).toBeUndefined();
      expect(httpAuthOtherOrigin(httpAuth([]), 'https://evil.example')).toBeUndefined();
      expect(httpAuthOtherOrigin(null, 'https://evil.example')).toBeUndefined();
    });
  });
});
