import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * The password minimum is one constant, `MIN_PASSWORD_LENGTH`, which the background enforces
 * (#141). Every form that offers it reads the same constant, so the two can never disagree: a form
 * that let through a password the background then refused would fail only after submitting.
 */
const ROOT = resolve(__dirname, '../..');
const FORMS = [
  'src/components/sidebar/SidebarSetup.vue',
  'src/pages/extension/VaultLogin.vue',
  'src/composables/useVault.ts',
  'src/components/dashboard/ExportDialog.vue',
];

describe('the password minimum in the forms', () => {
  it.each(FORMS)('%s uses MIN_PASSWORD_LENGTH and hard-codes no length', (path) => {
    const source = readFileSync(resolve(ROOT, path), 'utf8');

    expect(source).toContain('MIN_PASSWORD_LENGTH');
    expect(source).not.toMatch(/length\s*(<|>=)\s*\d+/);
    expect(source).not.toMatch(/Minimum \d+ characters/);
  });

  it('keeps the number out of the messages, which take it as a parameter', () => {
    const messages = readFileSync(resolve(ROOT, 'src/i18n/en-US/index.ts'), 'utf8');

    expect(messages).toContain("passwordTooShort: 'Use at least {min} characters'");
    expect(messages).toContain("minimum: 'Minimum {min} characters'");
  });
});
