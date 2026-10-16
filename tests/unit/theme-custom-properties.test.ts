import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * Guards a failure mode that is silent at build time and invisible in review.
 *
 * Sass does not evaluate SassScript inside a custom-property value; the value is emitted as plain
 * CSS text. `--header-bg: $light-header;` therefore ships the literal string `$light-header`, which
 * is an invalid property value, so every `var(--header-bg)` consumer resolves to nothing and the
 * application chrome renders with no background. Interpolation is required: `#{$light-header}`.
 *
 * Nothing else catches this. Sass compiles it without a warning, the stylesheet is valid CSS, and
 * the only symptom is a missing background that a reviewer has to notice by eye.
 */

const THEME_FILE = resolve(__dirname, '../../src/css/quasar.variables.scss');

/** A custom-property declaration, capturing the property name and its value. */
const CUSTOM_PROPERTY = /^\s*(--[\w-]+)\s*:\s*([^;]+);/gm;

/** Bare `$var` outside `#{}`, which Sass will not substitute. */
const UNINTERPOLATED_SASS_VARIABLE = /\$[\w-]+/;

const stripInterpolations = (value: string): string => value.replace(/#\{[^}]*\}/g, '');

interface CustomProperty {
  name: string;
  value: string;
}

/** Capture groups are optional to the type checker, so narrow once here rather than at each use. */
const parseCustomProperties = (scss: string): CustomProperty[] =>
  [...scss.matchAll(CUSTOM_PROPERTY)].flatMap(([, name, value]) =>
    name && value ? [{ name, value: value.trim() }] : [],
  );

describe('theme custom properties', () => {
  const properties = parseCustomProperties(readFileSync(THEME_FILE, 'utf8'));

  it('parses the theme file', () => {
    expect(properties.length).toBeGreaterThan(0);
  });

  it('interpolates every Sass variable used in a custom-property value', () => {
    const offenders = properties
      .filter(({ value }) => UNINTERPOLATED_SASS_VARIABLE.test(stripInterpolations(value)))
      .map(({ name, value }) => `${name}: ${value}`);

    expect(offenders).toEqual([]);
  });

  it.each(['--header-bg', '--badge-bg'])(
    'declares %s from an interpolated variable in both themes',
    (name) => {
      const declarations = properties.filter((p) => p.name === name).map(({ value }) => value);

      expect(declarations).toHaveLength(2);
      for (const value of declarations) {
        expect(value).toMatch(/^#\{\$[\w-]+\}$/);
      }
    },
  );

  /**
   * Chrome tokens only mean anything as a set. A theme that defines the background but not the
   * foreground or the edge renders unreadable text or an invisible band, which is the class of
   * defect #146 and #153 both came from.
   */
  it('defines every chrome token in both themes', () => {
    const chromeTokens = [
      '--header-bg',
      '--on-header',
      '--header-border',
      '--badge-bg',
      '--on-badge',
    ];

    for (const name of chromeTokens) {
      expect(properties.filter((p) => p.name === name)).toHaveLength(2);
    }
  });
});
