import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * Supply-chain controls on the CI and release workflows (#143, threat model T27).
 *
 * A workflow runs with the repository token, and the release workflow also holds the store
 * publishing secrets. So every action is pinned to a commit, which a moved tag cannot change, and
 * the token is read-only unless a job grants itself more.
 */
const DIR = resolve(__dirname, '../../.github/workflows');
const workflows = readdirSync(DIR)
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({ name, source: readFileSync(resolve(DIR, name), 'utf8') }));

describe('workflow hardening', () => {
  it('finds the workflows', () => {
    expect(workflows.map(({ name }) => name).sort()).toEqual(['ci.yml', 'e2e.yml', 'release.yml']);
  });

  it.each(workflows)('$name pins every action to a commit SHA with its version', ({ source }) => {
    const uses = [...source.matchAll(/^\s*(?:-\s*)?uses:\s*(.+)$/gm)].map(([, value]) =>
      value!.trim(),
    );

    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      expect(use).toMatch(/^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40} # v\d+(\.\d+){0,2}$/);
    }
  });

  it.each(workflows)('$name is read-only at workflow level', ({ source }) => {
    // The block before `jobs:` is the workflow level; a job may grant itself more below.
    const header = source.slice(0, source.search(/^jobs:/m));

    expect(header).toMatch(/^permissions:\s*\n\s+contents: read\s*$/m);
    expect(header).not.toMatch(/:\s*write/);
  });

  it('grants write access only to the release jobs that need it', () => {
    const release = workflows.find(({ name }) => name === 'release.yml')!.source;
    const writers = [
      ...release.matchAll(
        /^  ([\w-]+):\n(?:(?!^  \S).*\n)*?\s+permissions:\n((?:\s+\w[\w-]*: \w+\n)+)/gm,
      ),
    ]
      .filter(([, , grants]) => /write/.test(grants!))
      .map(([, job]) => job);

    expect(writers.sort()).toEqual(['build', 'release-please']);
  });
});
