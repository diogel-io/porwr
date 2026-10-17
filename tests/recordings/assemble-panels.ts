import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One recorded state: what the panel rendered, and how the page labels it. */
export interface RecordedPanel {
  title: string;
  note: string;
  /** The panel's `#q-app` element as the build rendered it. */
  markup: string;
}

export interface AssembleOptions {
  panels: RecordedPanel[];
  /** The stylesheet rules the panels used, with media queries already resolved at panel width. */
  css: string;
  /** `document.body.className` from the panel, so Quasar's theme selectors still apply. */
  bodyClass: string;
  /** The commit the build came from, as shown in the page. */
  revision: string;
  /** The built extension's asset folder, which holds the icon font the CSS refers to. */
  assetsDir: string;
  /** Inter, latin subset. The build loads it from Google Fonts at runtime; the file must not. */
  interWoff2: Buffer;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dataUri = (bytes: Buffer): string => `data:font/woff2;base64,${bytes.toString('base64')}`;

const KEYFRAMES = /@keyframes\s+([\w-]+)\s*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g;

/**
 * Makes the captured CSS self-contained: icon font inlined from the build, Inter inlined, and only
 * the keyframes something on screen uses.
 */
function selfContainedCss(css: string, assetsDir: string, interWoff2: Buffer): string {
  let out = css.replace(/@font-face\s*\{[^}]*Material Icons[^}]*\}/, (rule) => {
    const file = /url\("?\.\/([^")]+\.woff2)"?\)/.exec(rule)?.[1];
    if (!file) throw new Error(`No woff2 source in the icon font rule: ${rule}`);
    const bytes = readFileSync(join(assetsDir, file));
    return (
      '@font-face { font-family: "Material Icons"; font-style: normal; font-weight: 400; ' +
      `font-display: block; src: url("${dataUri(bytes)}") format("woff2"); }`
    );
  });

  out =
    '@font-face { font-family: "Inter"; font-style: normal; font-weight: 100 900; font-display: swap; ' +
    `src: url("${dataUri(interWoff2)}") format("woff2"); ` +
    'unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, ' +
    'U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }\n' +
    out;

  const withoutKeyframes = out.replace(KEYFRAMES, '');
  const used = new Set(
    Array.from(withoutKeyframes.matchAll(/animation(?:-name)?:\s*([\w-]+)/g), (m) => m[1]),
  );
  out = out.replace(KEYFRAMES, (rule, name: string) => (used.has(name) ? rule : ''));

  if (/url\("?\.\//.test(out) || out.includes('fonts.googleapis')) {
    throw new Error('The recorded CSS still refers to a file outside the page.');
  }
  return out;
}

/** Prefixes ids per panel: they repeat across panels, and labels must point at their own field. */
function isolate(markup: string, index: number): string {
  const out = markup
    .replace('id="q-app"', 'class="q-app"')
    .replace(
      /\b(id|for|aria-labelledby|aria-describedby|aria-controls)="([^"]+)"/g,
      (_, attribute: string, value: string) => `${attribute}="p${index}-${value}"`,
    );
  if (out.includes('chrome-extension://') || out.includes('<script')) {
    throw new Error(`Panel ${index} carries a script or an extension URL.`);
  }
  return out;
}

/** Builds the self-contained page from a recording run. */
export function assemblePanelPage(options: AssembleOptions): string {
  const css = selfContainedCss(options.css, options.assetsDir, options.interWoff2);
  const revision = escapeHtml(options.revision);

  const figures = options.panels
    .map((panel, i) => {
      const n = i + 1;
      return `    <figure class="state" id="panel-${n}">
      <figcaption>
        <span class="state__id">${n} · ${escapeHtml(panel.title)}</span>
        <span class="state__note">${escapeHtml(panel.note)}</span>
      </figcaption>
      <div class="panel-frame">
${isolate(panel.markup, n)}
      </div>
    </figure>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Porwr sidebar panel states</title>
<!--
  Recorded from the Porwr build, not drawn. Each panel is the markup the built extension rendered
  at 360 x 640 in the light theme, with the stylesheet rules those panels use. See README.md for
  provenance and how to re-record. Source: diogel-io/porwr@${revision}.
-->
<style>
${css}
</style>
<style>
  /* Recording frame. Not part of the build. */
  html, body.recording { background: #e9edf3; }
  body.recording { margin: 0; color: #0b1220; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .recording__intro { max-width: 760px; padding: 40px 16px 8px; margin: 0 auto 0 0; padding-left: max(16px, 48px); }
  .recording__kicker { font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; }
  .recording__title { margin: 6px 0 10px; font-size: 26px; font-weight: 600; line-height: 1.2; letter-spacing: -0.0125em; color: #f97316; }
  .recording__intro p { margin: 0 0 8px; font-size: 14px; line-height: 1.6; color: #475569; }
  .recording__intro code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .recording__grid { display: flex; flex-wrap: wrap; gap: 40px 32px; align-items: flex-start; padding: 24px 16px 80px; padding-left: max(16px, 48px); }
  .state { margin: 0; display: flex; flex-direction: column; gap: 10px; width: 362px; max-width: 100%; }
  .state figcaption { display: flex; flex-direction: column; gap: 4px; min-height: 52px; }
  .state__id { font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.06em; text-transform: uppercase; color: #334155; }
  .state__note { font-size: 12.5px; line-height: 1.45; color: #64748b; }
  .panel-frame { box-sizing: content-box; position: relative; width: 360px; max-width: calc(100% - 2px); height: 640px; overflow: hidden; transform: translateZ(0);
    border: 1px solid rgba(0, 0, 0, 0.12); box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08); text-align: left; }
  .panel-frame .q-app { box-sizing: border-box; height: 100%; }
  .panel-frame .sidebar-root { height: 100% !important; min-height: 0 !important; }
  .panel-frame .q-page { min-height: 0 !important; }
</style>
</head>
<body class="${escapeHtml(options.bodyClass)} recording">
  <header class="recording__intro">
    <div class="recording__kicker">Recorded from the build · diogel-io/porwr@${revision}</div>
    <h1 class="recording__title">Porwr sidebar panel: current build</h1>
    <p>Every panel below was rendered by the built extension and recorded as it appeared: light theme,
      a 360 x 640 panel, the markup the build produced and the stylesheet rules it used. Nothing here
      is drawn by hand, and nothing here is a proposal.</p>
    <p>At 360px and below the header drops the <code>Porwr</code> wordmark and keeps the logo
      (<code>Layout.vue</code>), so no panel here shows it. Panel bodies scroll, as they do in the build.</p>
    <p>State ids refer to <code>../sidebar-interaction-specification.md</code> §5; decision ids to
      <code>../../architecture/sidebar-request-lifecycle-adr.md</code>.</p>
  </header>
  <main class="recording__grid">
${figures}
  </main>
</body>
</html>
`;
}
