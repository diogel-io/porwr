import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * No Porwr stylesheet, and nothing the approval panel renders, loads a remote resource
 * (D13, threat model T7, #144).
 *
 * The e2e spec `approval-network-silence.spec.ts` watches the real panel, but only in Chromium:
 * Firefox is driven through WebDriver, which cannot observe requests. This reads the source both
 * builds share, so a remote font, image or fetch added to these surfaces fails in either.
 */

const ROOT = resolve(__dirname, '../..');

const filesUnder = (dir: string, extensions: readonly string[]): string[] =>
  readdirSync(resolve(ROOT, dir)).flatMap((name) => {
    const path = join(resolve(ROOT, dir), name);
    if (statSync(path).isDirectory()) return filesUnder(relative(ROOT, path), extensions);
    return extensions.some((extension) => name.endsWith(extension)) ? [path] : [];
  });

const REMOTE = [
  /@import\s+url\(\s*['"]?https?:/i,
  /url\(\s*['"]?https?:/i,
  /\bsrc\s*=\s*['"]https?:/i,
  /\bfetch\s*\(/,
];

const offending = (paths: readonly string[]): string[] =>
  paths.flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return REMOTE.filter((pattern) => pattern.test(source)).map(
      (pattern) => `${relative(ROOT, path)} matches ${String(pattern)}`,
    );
  });

describe('remote resources', () => {
  it('are not loaded by any stylesheet', () => {
    expect(offending(filesUnder('src/css', ['.scss', '.css']))).toEqual([]);
  });

  it('are not loaded by the approval panel', () => {
    const panel = [
      ...filesUnder('src/components/sidebar', ['.vue', '.ts']),
      ...filesUnder('src/pages/sidebar', ['.vue', '.ts']),
      ...filesUnder('src/layouts/sidebar', ['.vue', '.ts']),
    ];
    expect(panel.length).toBeGreaterThan(0);
    expect(offending(panel)).toEqual([]);
  });

  // The background half of presenting a request: queueing it, deciding it, and the badge. None of
  // it may look anything up about the site.
  it('are not fetched by the background on the approval path', () => {
    const approvalPath = [
      'src-bex/services/approval-flow.ts',
      'src-bex/services/request-queue.ts',
      'src-bex/services/page-channel.ts',
      'src-bex/services/attention-badge.ts',
      'src/services/approval-preview.ts',
    ].map((path) => resolve(ROOT, path));
    expect(offending(approvalPath)).toEqual([]);
  });

  // Porwr's own pages show images that profiles and relays name. Each goes through `RemoteImage`,
  // which holds it back while "Load remote images" is off (T32, diogel-io/workspace#148). An image
  // that binds its own `src` would skip that.
  it('are shown on Porwr pages only through RemoteImage', () => {
    const BOUND_IMAGE = /<(?:img|q-img)\b[^>]*\s(?::|v-bind:)src\s*=/i;
    const ALLOWED = new Set([
      'src/components/shared/RemoteImage.vue',
      // Binds the bundled logo, which the build resolves to a file inside the extension.
      'src/components/shared/DiogelLogo.vue',
    ]);
    const pages = filesUnder('src', ['.vue']).filter((path) => !ALLOWED.has(relative(ROOT, path)));
    expect(pages.length).toBeGreaterThan(0);
    expect(
      pages
        .filter((path) => BOUND_IMAGE.test(readFileSync(path, 'utf8')))
        .map((path) => relative(ROOT, path)),
    ).toEqual([]);
  });

  it('ships the bundled font the stylesheet names', () => {
    const fonts = readdirSync(resolve(ROOT, 'src/css/fonts'));
    for (const weight of [400, 500, 600, 700]) {
      expect(fonts).toContain(`inter-latin-${weight}-normal.woff2`);
    }
    expect(fonts).toContain('LICENSE-Inter.txt');
  });
});
