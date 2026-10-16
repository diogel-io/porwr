# Recordings

Specs here drive the built extension into a state and write what it rendered to a file. They are
not tests: they assert only what they need to reach each state, and the main Playwright config never
runs them. They reuse the end-to-end fixtures in `../e2e/fixtures/`.

## Sidebar panel states

Records every sidebar state reachable from one window, as the design record
`10-products/porwr/design/sidebar-design/sidebar-panel-states.html` in the Diogel workspace
(diogel-io/workspace#5).

```bash
RECORD_OUT=~/Documents/diogel/10-products/porwr/design/sidebar-design/sidebar-panel-states.html \
  npm run record:sidebar
```

This builds the Chromium extension, then records. Without `RECORD_OUT` the page goes to
`test-results/recordings/sidebar-panel-states.html`. Set `RECORD_SCREENSHOTS` to a folder to also
keep a screenshot of each live panel, for comparing the page against the build.

Each state is the panel's rendered markup at 360 x 640 in the light theme. The page carries the
stylesheet rules that matched something on screen in any state. Media queries are resolved at the
panel's width, so the page shows what a 360px panel shows wherever it is opened. The page is
self-contained: the icon font comes from the build, and Inter, which the build loads from Google
Fonts at runtime, is fetched once while recording and embedded.

Recording needs network access for that one font request. Everything the panel itself talks to is
stood in for: the requesting sites are routed test pages, and a stand-in relay serves the profile
shown on the S1 card.

The revision shown in the page is the checkout's commit, marked `-dirty` when `src/` or `src-bex/`
have uncommitted changes.

When the panel gains a state or changes how one is reached, update `sidebar-panels.record.ts`.
States the build cannot reach are left out rather than drawn. S13's expired notice is the known
case.
