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

  const releaseSource = () => workflows.find(({ name }) => name === 'release.yml')!.source;

  /**
   * Each release job that sets permissions, with the grants it sets. A grant may carry a trailing
   * comment, which is dropped, so a comment can neither end the list early nor hide a grant.
   */
  const releaseGrants = () =>
    [
      ...releaseSource().matchAll(
        /^  ([\w-]+):\n(?:(?!^  \S).*\n)*?\s+permissions:\n((?:\s+\w[\w-]*: \w+(?:\s+#.*)?\n)+)/gm,
      ),
    ].map(([, job, grants]) => ({
      job: job!,
      grants: grants!
        .trim()
        .split('\n')
        .map((line) => line.replace(/\s+#.*$/, '').trim()),
    }));

  /** The lines of one release job, up to the next job. */
  const releaseJob = (job: string) => {
    const match = releaseSource().match(new RegExp(`^  ${job}:\\n((?:(?!^  \\S).*\\n)*)`, 'm'));
    return match?.[1] ?? '';
  };

  it('grants write access only to the release jobs that need it', () => {
    const writers = releaseGrants()
      .filter(({ grants }) => grants.some((grant) => grant.endsWith('write')))
      .map(({ job }) => job);

    expect(writers.sort()).toEqual(['build', 'close-milestone', 'release-please']);
  });

  it('lets the milestone job write to issues and nothing else (#409)', () => {
    const closeMilestone = releaseGrants().find(({ job }) => job === 'close-milestone');

    expect(closeMilestone?.grants).toEqual(['issues: write']);
  });

  it('closes the milestone only after release-please has created a release (#409)', () => {
    const job = releaseJob('close-milestone');

    // `release-please` runs only on a push, so a manual dispatch never reaches this job either.
    expect(job).toMatch(/^\s+needs: \[release-please\]$/m);
    expect(job).toMatch(/^\s+if: needs\.release-please\.outputs\.release_created == 'true'$/m);
    expect(job).toMatch(/gh api --paginate "repos\/\$GITHUB_REPOSITORY\/milestones\?state=open/);
  });
});
