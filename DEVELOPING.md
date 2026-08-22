# Developing Porwr

How to get a change in front of your eyes, and what the tooling does not do for you.

## Node

Use the pinned version:

```bash
nvm use          # v24.19.0, from .nvmrc
```

That is the whole answer, and the rest of this section is only for when something has gone wrong
anyway.

**The real floor is Node 22.22.0**, and it is not written down anywhere you would look.
`@quasar/app-vite` 2.6.1 declares `engines.node` as `^22 || ^24 || ^26 || ^28 || ^30` but checks for
`22.22.0 or superior` at runtime, so matching its published range is not enough.

`package.json` declares `^22.22 || ^24 || ^26 || ^28` to match what will actually build. It used to
say `^22`, which admitted every 22.x below 22.22 — versions npm therefore had no reason to warn
about, even though the toolchain refuses them.

On a version below the floor, `npm install` fails at `postinstall`, where `quasar prepare` hits the
same check the builds do:

```
 INCOMPATIBLE NODE VERSION
 @quasar/app-vite requires Node 22.22.0 or superior
```

`.npmrc` sets `engine-strict=true`, so a Node below the floor is refused at install time rather
than at the first build.

The trade-off is worth knowing before it surprises you: strict mode applies to **every dependency's**
`engines`, not only ours. A transitive package raising its floor past `.nvmrc` fails the install
outright, here and in CI, with no change of ours involved. While the pin was 24.14.0,
`mute-stream@4.0.0` requiring `^24.15.0` was already enough to do it.

If an install starts failing with `EBADENGINE` for a package nobody touched, that is what happened.
Raise `.nvmrc`, do not remove the flag — and check Quasar still supports the newer Node first, since
it enforces a floor at runtime that its own `engines` field does not declare (#203).

CI never had this problem: every workflow uses `node-version-file: '.nvmrc'`.

## Security advisories

`npm audit` reports the whole dependency tree, most of which is build tooling that never reaches a
user. **The figure worth watching is `npm audit --omit=dev`**, which is what ships.

At the time of writing that is **zero**, and the full report is two low advisories.

Both are `esbuild` reached through `@quasar/app-vite` 2.6.1, and both describe arbitrary file reads
**by the development server on Windows**. They are left in place deliberately:

- resolving them needs `@quasar/app-vite` 3.x, a major upgrade of the entire build toolchain, which
  is not a security patch and should not be smuggled in as one
- the dev server is not part of this project's workflow anyway — `quasar dev -m bex` emits a 0-byte
  `www/index.html` and gives no working panel (see below), so the panel is always run from a build

Quote the `--omit=dev` figure when the total is questioned, and check what a "39 vulnerabilities"
headline actually contains before reacting to it: when this was last examined, 25 of 39 came from a
single devDependency that ran perhaps once a year (threenine/diogel#204).

## Install scripts

`package.json` carries an `allowScripts` block. npm runs a dependency's install script only if it
is listed there, so a package newly gaining one fails the install rather than running quietly.

| Entry | Script | Why |
|---|---|---|
| `esbuild@0.27.7` | `postinstall: node install.js` | Fetches the platform binary. The build does not run without it. |
| `geckodriver@6.1.1` | `postinstall: node ./dist/install.js` | Fetches the Firefox WebDriver binary the Firefox end-to-end project drives. |
| `@parcel/watcher` | `install: node scripts/build-from-source.js` | **Denied.** Compiles native code at install time, and nothing here loads it. |

The two approvals are **pinned to a version**, so an upgrade needs approving again rather than
inheriting trust from the version that was reviewed. Expect `npm ci` to fail after bumping esbuild
or geckodriver; that is the mechanism working. Re-approve with:

```bash
npm approve-scripts --allow-scripts-pin <pkg>
```

`@parcel/watcher` is denied rather than approved because it arrives through `sass`, and `sass` is
here only as an optional peer dependency of Vite that npm installs speculatively. The SCSS is
compiled by `sass-embedded`, a declared dependency of `@quasar/app-vite`. Verified: removing
`node_modules/sass` leaves both builds and all unit tests passing (threenine/diogel#207).

Do not reach for `--omit=optional` to drop it — rolldown and lightningcss ship their native
bindings as optional dependencies, so the build fails on a missing binding long before it reaches
sass.

## Building

```bash
npm run build:chrome     # dist/bex-chrome
npm run build:firefox    # dist/bex-firefox
```

Load the folder unpacked:

- **Chromium** — `chrome://extensions` → Developer mode → Load unpacked → `dist/bex-chrome`
- **Firefox** — `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → pick any file
  inside `dist/bex-firefox`

## `quasar dev -m bex` does not currently give you a working panel

Measured on `@quasar/app-vite` 2.6.1, Chromium target, with the dev server running:

- the dev build lands in `dist/bex-chrome--dev`
- its `www/index.html` is **0 bytes**, and `assets/` contains only `content.css` — the UI bundle is
  never written into the extension folder
- the manifest still points the panel at `www/index.html#/sidebar`, so loading the dev extension and
  opening the panel gives Chromium's `chrome-error://chromewebdata/` page, not the panel
- the UI itself is served by Vite on its own port and is reachable in a normal tab, but a panel must
  be an extension page, so that does not help the surface being developed

The background, content script and provider **are** emitted and rebuilt on change, so dev mode is
still useful for work that does not involve the panel UI.

**Use a production build for panel work.** It is slower per iteration but it is the surface that
actually renders.

## The loop that works

```bash
npm run build:chrome
# reload the extension from chrome://extensions, then reopen the panel
```

What each change costs:

| Changed | Needed |
|---|---|
| Panel UI (`src/`) | rebuild, reload the extension, reopen the panel |
| Background (`src-bex/`) | rebuild, reload the extension — the worker restarts, and every pending request becomes `interrupted` by design (ADR D7) |
| Manifest (`src-bex/manifest.json`) | rebuild and **remove and re-add** the unpacked extension; Chromium does not always pick up manifest changes on reload |

Reloading the extension tears down the panel's connection to the background. That is the same path
as a service-worker restart, which the panel already handles by reconnecting and re-reading, so it is
worth knowing rather than worth avoiding.

## Running the panel in a tab

The panel is an ordinary extension page, so you can open it directly:

```
chrome-extension://<extension-id>/www/index.html#/sidebar
```

It is the same route, layout and components as the real panel. Panel presence is detected by port
name alone rather than by the absence of a tab, precisely so this works — see
`src-bex/services/panel-presence.ts`.

What it does **not** exercise: the browser-owned surface. That the manifest wires `side_panel` and
`sidebar_action`, and that the toolbar reveals the panel, are only observable in the real thing.

## Tests

```bash
npm run test:run         # unit, ~800 tests
npm run test:e2e         # Chromium, builds the extension first
npm run test:e2e:firefox # Firefox, via WebDriver
npm run lint
npm run typecheck
```

See `tests/e2e/README.md` for how the browsers are driven and what the end-to-end suite cannot cover.

### Coverage policy

Coverage is enforced. `npm run test:coverage` fails if any threshold in `vitest.config.ts` is
breached, and CI runs it on every pull request.

The thresholds are a **ratchet**, not an achievement. Each one sits just below where coverage
actually stands, so a genuine regression fails and ordinary noise does not:

| | Floor | Actual (2026-08-21) |
|---|---|---|
| Statements | 59% | 59.77% |
| Branches | 52% | 52.05% |
| Functions | 51% | 51.39% |
| Lines | 60% | 60.02% |

**The target is 75%** across the board. The floors are raised toward it as coverage rises, and are
never lowered: if a change cannot meet the current floor, the answer is a test, not a smaller number.

**Every source file is measured, not only the ones a test imports.** `coverage.include` is set for
that reason. Without it, 35 of 157 source files — 5,935 lines — were absent from the denominator
rather than counted as uncovered, which both flattered the figure by roughly fifteen points and
inverted the incentive: removing the last test that imported a file made coverage go up. Earlier
figures in this repository, including the baseline recorded on #124, were measured that way and read
about fifteen points higher than the truth.

Message catalogues (`src/i18n`), Quasar boot files and declaration files are excluded as data rather
than logic.

The layers that decide authority — `src/services`, `src/composables`, `src/utils`,
`src-bex/handlers`, `src-bex/services` — are already past 75% and are held there by their own
per-directory thresholds. Without those, the global floor would let them slide while the component
layer pulled the average around. Expect a per-directory threshold to fail a pull request for a file
it did not touch: adding an uncovered file to a well-covered directory is exactly what it is for.

Branches are the furthest from target and matter most. In a signing extension the untested branch is
the one that fails open.

`src-bex/background.ts` is still not measured — the provider reports `Failed to parse ...
background.ts. Excluding it from coverage.` because nothing imports it, so it is read from disk
rather than through the Vite transform. It appears in no figure above, in either direction.

That matters less than it did. #173 moved what it decided into modules that are measured: the
approval flow, the raw message routing decision and the page reconciliation, all now covered. What
remains in the file is the `bridge.on` registrations and startup ordering — wiring, which the
end-to-end suite exercises against a real extension rather than a mock.

The Vue component layer has no threshold. #123 deliberately left component structure alone, and a
floor there would measure work nobody has agreed to do.

**What coverage does not tell you.** It measures execution, not assertion. A test that runs a line
and asserts nothing counts the same as one that checks the result — two tests written during this
work passed while asserting nothing meaningful. Treat the number as a floor against regression, never
as evidence that something is tested.

## A known dead branch

Building the background emits:

```
▲ [WARNING] "import.meta" is not available with the "iife" output format and will be empty
    src/stores/settings-store.ts:191:4
```

`src/stores/settings-store.ts` guards a Pinia HMR block behind `import.meta.hot`. The background is
bundled as IIFE, where `import.meta` is empty, so that block is unreachable in the background build
and the warning is emitted on every build of both targets. It is harmless and it is noise; removing
it or scoping it to the UI build would be a small cleanup.
