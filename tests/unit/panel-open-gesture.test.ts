import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * Guards the one rule both browsers enforce and neither reports usefully.
 *
 * `sidePanel.open()` and `sidebarAction.open()` may only be called from inside a user-gesture
 * handler. Called anywhere else they reject at runtime, in the background, where nobody is watching
 * — so the failure is a panel that silently does not open (ADR D4, #113).
 *
 * The rule is therefore structural: only the panel-surface port may call them, and only through
 * `openFromUserGesture`, which the toolbar handler invokes.
 */

const ROOT = resolve(__dirname, '../..');
const PORT = 'src-bex/services/panel-surface.ts';

const sourceFiles = (dir: string): string[] => {
  const entries = readdirSync(join(ROOT, dir));
  return entries.flatMap((entry) => {
    const relative = join(dir, entry);
    if (statSync(join(ROOT, relative)).isDirectory()) return sourceFiles(relative);
    return /\.(ts|vue)$/.test(entry) && !entry.endsWith('.d.ts') ? [relative] : [];
  });
};

/** Any reference to a browser panel API at all, however it is reached. */
const PANEL_API = /\b(sidePanel|sidebarAction)\b/;

/**
 * Comments name these APIs when explaining why only the port may call them, and prose is not a
 * violation. Stripping first keeps the rule about code.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('opening the panel', () => {
  const files = [...sourceFiles('src'), ...sourceFiles('src-bex')];

  it('finds the source tree, so this cannot pass by looking at nothing', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(PORT);
  });

  it('touches a browser panel API from the port and nowhere else (D17)', () => {
    // The port is the only place either API is named. That is what makes the gesture rule
    // enforceable at all: one method, one caller, one place to read.
    const offenders = files.filter(
      (file) =>
        file !== PORT && PANEL_API.test(withoutComments(readFileSync(join(ROOT, file), 'utf8'))),
    );

    expect(offenders).toEqual([]);
  });

  it('offers exactly one way to open the panel, and it names the gesture', () => {
    const port = readFileSync(join(ROOT, PORT), 'utf8');

    const surface = /export interface PanelSurface \{([\s\S]*?)\n\}/.exec(port)?.[1] ?? '';
    const members = [...surface.matchAll(/^\s{2}(\w+)\s*[(<]/gm)].map(([, name]) => name ?? '');

    expect(members).toContain('openFromUserGesture');
    // `isOpenAccordingToBrowser` reports state and opens nothing. Anything else with "open" in its
    // name would be a second opening path, which is what D4 forbids.
    expect(members.filter((name) => /open/i.test(name)).sort()).toEqual([
      'isOpenAccordingToBrowser',
      'openFromUserGesture',
    ]);
  });
});
