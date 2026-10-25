# AGENTS.md

This file is the binding guidance for anyone, human or coding agent, working in this repository.
It is self-contained: you do not need any other checkout to build, test, and change Porwr safely.
`CLAUDE.md` points here.

## What Porwr is

Porwr is the browser product in the [Diogel](https://github.com/diogel-io) suite of Nostr identity
and key-protection tools. It is a [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md)
signer extension for Chrome and Firefox: it injects a `window.nostr` provider into web pages so
Nostr apps can request public keys, signatures, and NIP-04/NIP-44 encryption without ever
receiving the user's private key. It also offers WebLN payments through a NIP-47 wallet
connection, NIP-17 direct messages, and Blossom media management.

It is a Quasar 2 / Vue 3 browser extension (BEX), built with `@quasar/app-vite` 3, using Pinia for
UI state and Dexie (IndexedDB) for storage. NIP-07 is its primary NIP target.

Porwr guards private keys. Treat every change to how a request reaches a signature as
security-sensitive, and read [Security invariants](#security-invariants) before you change one.

Product requirements, design, research, architecture decision records (ADRs), and release
planning live in the Diogel workspace repository, `diogel-io/workspace`, which is private. Work is
tracked there as `diogel-io/workspace#<n>` issues. The decisions that bind this code are restated
below so you can follow them without access to it.

## Read first

1. This file.
2. [CODINGSTANDARDS.md](CODINGSTANDARDS.md): lint and format, TypeScript discipline,
   Domain-Driven Design, and testing conventions.
3. [DEVELOPING.md](DEVELOPING.md): the Node version, building, the reload loop that actually
   works, tests, and the coverage ratchet.
4. [tests/e2e/README.md](tests/e2e/README.md): how the end-to-end suite drives both browsers and
   what it cannot cover.
5. [DEPLOYMENT.md](DEPLOYMENT.md): how releases are cut and published.
6. [docs/threat-model.md](docs/threat-model.md): the assets, trust boundaries, threats, and
   controls the security invariants below protect. Read it before a security-sensitive change.
7. [SECURITY.md](SECURITY.md): how vulnerabilities are reported, the list of security-sensitive
   paths, and the review checklist a change to one of them must pass.

## Commands

Use a Node version from `engines.node` in `package.json` (`^22.22 || ^24 || ^26 || ^28`); `.nvmrc`
pins the one CI and releases use. The npm lockfile is canonical.

| Task                     | Command                                                 |
| ------------------------ | ------------------------------------------------------- |
| Install                  | `npm ci` (`postinstall` runs `quasar prepare`)          |
| Build the Chrome BEX     | `npm run build:chrome`                                  |
| Build the Firefox BEX    | `npm run build:firefox`                                 |
| Build the default app    | `npm run build`                                         |
| Lint                     | `npm run lint` (add `-- --fix` to autofix)              |
| Format                   | `npm run format` (Prettier 3, honours `.gitignore`)     |
| Typecheck                | `npm run typecheck` (`vue-tsc --noEmit`, strict)        |
| Unit tests               | `npm run test:run` (`npm run test` to watch)            |
| Unit tests with coverage | `npm run test:coverage` (fails below the ratchet)       |
| Single test file         | `npx vitest run tests/unit/services/auto-lock.test.ts`  |
| Single test by name      | `npx vitest run -t "test name pattern"`                 |
| End-to-end, Chromium     | `npm run test:e2e` (builds the extension first)         |
| End-to-end, Firefox      | `npm run test:e2e:firefox` (builds the extension first) |

`npm run dev` (`quasar dev -m bex`) does not give a working panel. Build the extension and reload
it in the browser instead; [DEVELOPING.md](DEVELOPING.md) describes the loop.

BEX icons are committed and need no build step. Regenerate them only if the source artwork
changes; see the README.

## Verification gate

Run the same steps as `.github/workflows/ci.yml` before opening or updating a pull request:

```bash
bash .github/scripts/test-publish-chrome.sh
npm ci
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run build:chrome
npm run build:firefox
```

For a change to the panel, the approval flow, or anything a page can reach, also run
`npm run test:e2e` and `npm run test:e2e:firefox`. CI runs the end-to-end suites nightly
(`.github/workflows/e2e.yml`), not on every pull request, so a pull request can pass CI and still
break them.

Add or update tests for every behaviour change, and never lower a coverage threshold or weaken a
test to get a pass.

## Architecture

### Message flow (web page → background → vault)

1. `src-bex/content-script.ts` injects `src-bex/nostr-provider.js` into the page (provides
   `window.nostr`) and relays `window.postMessage` traffic via
   `src-bex/window-message-handler.ts` (origin/security checks in
   `window-message-security.ts`).
2. The content script sends each request over Porwr's own `porwr:page` port
   (`src-bex/page-port-client.ts`) to `src-bex/background.ts`, the BEX service worker /
   extension background. It sends no origin: `src-bex/services/page-channel.ts` takes the
   requesting site from the port's browser-supplied `sender` (`pageOriginOf` in
   `services/sender-policy.ts`) and refuses a request whose sender names no http(s) site. The
   Quasar bridge serves only `ping`, because a bridge handler cannot tell which port a message
   came from (#246).
3. `background.ts`'s `pageActionHandlers` serve the page allowlist (`src-bex/page-actions.ts`),
   each given the sender's origin as an argument. They enforce approval/permission flow
   (`requestApproval`, `handlers/permission-handler.ts`), log activity via
   `src/services/log-service.ts`, then call `dispatchMessage` (`src-bex/dispatcher.ts`).
4. `dispatcher.ts` is the single switch-statement router from `BridgeAction` →
   handler in `src-bex/handlers/*` (vault, accounts, account-signing, active-key, nip04, nip07,
   nip44, nip47, webln, messaging, contacts, blossom, relay-browser, permissions). It is shared by
   the page handlers and the raw `chrome.runtime.onMessage` listener, which serves only Porwr's
   own pages.
5. Vault state itself (encryption, lock/unlock, account storage) lives in
   `src-bex/vault.ts`, with persistence through `src/services/storage-service.ts` /
   `dexie-storage.ts` / `database.ts` (Dexie/IndexedDB).

When adding a new `window.nostr` capability: add the type to `BridgeRequestMap` in
`src/types/bridge-types.d.ts`, add the method to `PAGE_METHOD_TO_ACTION` in
`src-bex/page-actions.ts`, add its handler to `pageActionHandlers` in `background.ts` (typecheck
requires one per allowlisted action), add a case in `dispatcher.ts`, implement the handler in
`src-bex/handlers/`, and wire the provider-side call in `nostr-provider.js`. Never read the origin
from the request.

### Wallet connection (NIP-47 one-click)

The background generates the NWC client secret and keeps it (`handlers/nip47.ts`,
`services/nip47-pending-authorization-store.ts`). Pages only ever see the public key. The wallet
answers with `nwc:success`, and that answer reaches the background by one of two routes:

- **Chromium.** Wallet Connections opens a throwaway connect window (`WalletConnectPage`), which
  opens the wallet's popup and receives `nwc:success` through `window.opener` (workspace#76).
- **Firefox.** A popup an extension page opens loses its opener there. So the background opens
  the wallet's popup itself (`nip47.authorization.open`), records its window and tab, and settles
  the authorization from one of three events (workspace#85):
  - The content script relays the wallet's answer (`src-bex/wallet-relay.ts`). It listens only in
    the tab the background armed (`services/wallet-relay-arm.ts`).
  - The window closes first (`services/wallet-connect-popup.ts`).
  - Wallet Connections stops waiting and cancels it (`nip47.authorization.cancel`), which closes
    the popup.

  Pending entries are claimed through a serialized store, so only one of these settles an
  authorization. A claimed entry stays in session storage until its result is final, so a Firefox
  event page that is suspended meanwhile can still have its popup closed. A popup whose authorization expires is closed when the store drops the entry. A
  cancel that arrives once a save's vault write has begun cannot stop it, so the save finishes and
  reports, and Wallet Connections reads its wallet list again after any cancelled connection.

  The relay uses its own `porwr:wallet-relay` port. The background accepts it only from the top
  frame of the bound tab, at the wallet's exact origin, as the browser-supplied `sender` reports
  it. The general runtime channel still refuses content scripts.

Both routes post their outcome on `wallet-connect-channel`. Both check the wallet's details and
call `get_info` before anything is saved.

### Approval / permission model

- Per-origin, per-event-kind permissions are checked via `checkPermission` /
  `grantPermission` in `src-bex/handlers/permission-handler.ts`.
- If permission isn't already granted, `requestApproval` (in `background.ts`) enqueues the
  request on the background-owned queue (`src-bex/services/request-queue.ts`) and awaits
  its terminal outcome, with "once" / "8h" / "always" durations and an expiry measured
  from creation.
- The sidebar panel presents the request and submits the decision against a request id.
  There is no popup fallback: when the panel is closed the toolbar badge shows the pending
  count and the user opens the panel themselves (ADR D4).
- If the vault is locked, the panel shows its own unlock view. The panel is never routed
  to a full-tab surface.

### Vault, accounts, and auto-lock

- `src-bex/vault.ts` + `src-bex/handlers/vault-handler.ts` own vault create/unlock/lock,
  import/export (encrypted), and account data.
- `src-bex/services/auto-lock.ts` manages the inactivity timer (`startAutoLockTimer`,
  `resetAutoLockTimer`, `restoreLastActivity`, `checkAutoLock`); `activity.mark` /
  most bridge calls reset it.
- Frontend composables `src/composables/useVault.ts`, `useVaultManagement.ts`,
  `useVaultAutoLock.ts`, `useAccounts.ts` wrap vault bridge calls for Vue components/pages.
- Pinia stores: `src/stores/account-store.ts`, `vault-store.ts`, `settings-store.ts`.

### Relay catalog / browser

- `src/services/relay-catalog.ts` (`RelayCatalogService`) is the **canonical** source of
  relay sort order (smart sort by online status, metadata richness, seed status), seeded
  via `loadSeedRelays()` at background startup.
- `src/services/relay-discovery.ts`, `relay-metadata.ts`, `relay-browser-orchestrator.ts`,
  and `src-bex/handlers/relay-browser-handler.ts` support the relay browser feature
  (`pages/RelayManagementPage.vue`, `RelayBrowserModal` component).
- UI components must preserve the background service's ordering and only apply
  non-destructive filtering via `src/utils/relay-filters.ts` — do not add secondary
  sorting in the UI.

### UI structure

- Routes: `src/router/routes.ts`. Layouts in `src/layouts/` are grouped by surface, matching
  `src/pages/`: `layouts/sidebar/Layout.vue` (`/sidebar`), `layouts/dashboard/Layout.vue`
  (`/dashboard`, `/settings`, `/profile`, `/relays`, key management),
  `layouts/extension/Layout.vue` (`/`), and `layouts/extension/LoginLayout.vue` (`/login`).
- Every layout declares `defineOptions({ name })`. Three of them are called `Layout.vue`, so
  the compiler-derived `__name` no longer tells them apart, and
  `tests/unit/sidebar-surface-boundary.test.ts` relies on the declared name to keep a
  dashboard layout out of the panel. A new layout without one is invisible to that guard.
- Pages in `src/pages/` are grouped by the surface they belong to, and every page sits in
  exactly one of them: `pages/sidebar/` (the panel), `pages/dashboard/` (the full-tab
  management surfaces), and `pages/extension/` (the entry point, vault login, and 404).
- Import shared code by the `@` alias, not by a relative path: `@/components/`, `@/stores/`,
  `@/services/`, `@/composables/`. `@/` maps to `src/`; it is the only alias
  `@quasar/app-vite` 3 injects, so the old `src/`, `components/`, `layouts/`, `pages/` and
  `app/` shortcuts no longer resolve. Reach extension code as `@/../src-bex/...`. A page that
  reaches out with `../` breaks the next time it moves between surface directories.
- Components in `src/components/` follow the same surface split, one convention throughout:
  `sidebar/`, `dashboard/` (with `dashboard/key-management/` for that feature group),
  `extension/`, and `shared/` for the components more than one surface reaches
  (`DiogelLogo`, `AccountDropdown`, `ProfileView`, `RemoteImage`, `RemoteImagesNotice`). No
  component sits at the top level.
  A component used by a second surface moves to `shared/` rather than being imported across
  surface directories.
- Import components by alias — `@/components/<surface>/<Name>.vue` — never by a relative path.
  Tests live in `tests/`, not beside the component.
- Boot files (`src/boot/i18n`) are auto-registered by Quasar; don't import them directly
  elsewhere. HTTP uses `fetch`; there is no HTTP client library (the unused axios boot file was
  removed in diogel-io/workspace#143).
- i18n messages live under `src/i18n/en-US`; the unplugin only picks up files under
  `src/i18n/`.
- Read environment values as `import.meta.env.*`, never `process.env`. App values are
  declared in `build.defineEnv` in `quasar.config.ts` (e.g. `import.meta.env.APP_VERSION`);
  Quasar's own constants carry the `QUASAR_` prefix (e.g. `import.meta.env.QUASAR_VUE_ROUTER_MODE`).
- `src-bex/package.json` exists because Quasar v3 requires it. Anything listed in its
  `dependencies` is **not** bundled into the background or content scripts, so runtime
  dependencies belong in the root `package.json`.

## Security invariants

These rules come from the Porwr ADRs and the threat model in
[docs/threat-model.md](docs/threat-model.md). Labels such as D1 refer to the decisions in the
sidebar request lifecycle ADR. Do not change one in code. If a rule stops a change you need, raise
it on the tracking issue so the decision is revisited first.

A change that adds an asset, a trust boundary, or a control, or changes one the threat model lists,
updates `docs/threat-model.md` in the same pull request. The model is public: describe an open,
exploitable weakness there only as a one-line summary with its tracking reference, as its
disclosure rule says.

A change to any path listed under "Sensitive paths" in [SECURITY.md](SECURITY.md) must pass its
security review checklist before it merges. Work through the checklist, record it in the pull
request template's "Security review" section, and never describe an unfixed vulnerability in a
public issue or pull request.

**Origin**

- The requesting site comes only from the browser-supplied `sender` of the `porwr:page` port
  (`pageOriginOf` in `src-bex/services/sender-policy.ts`). Never read the origin from a request
  payload, and refuse a request whose sender names no http(s) site.
- A new `window.nostr` or `window.webln` capability is added to the page allowlist
  (`src-bex/page-actions.ts`) with its own `pageActionHandlers` entry, as described under
  [Architecture](#architecture). Nothing reaches `dispatchMessage` from a page any other way.
- The approval shows the request's origin as a string, never the active tab's origin, and fetches
  nothing to present it: no favicon, title, or metadata lookups during approval (D2, D13).

**Consent**

- The background owns the request lifecycle (`src-bex/services/request-queue.ts`). The panel only
  observes and submits a decision against a request id, and is untrusted for lifecycle purposes
  (D1, D5). A decision naming an unknown, terminal, or expired request is refused.
- No signature, encryption, decryption, or payment happens without a standing grant or an explicit
  decision. There is no popup fallback and the panel is never opened automatically: when it is
  closed the toolbar badge shows the pending count (D3, D4).
- Unlocking the vault never approves the request that was waiting for it (D14).
- A request whose page callback is lost, for example after a service-worker restart, can never be
  signed (D7). Expiry is an absolute cap from creation, bounded in settings and clamped by the
  background (D8).
- Event kinds are risk-classified in `src/services/approval-preview.ts`. Elevated kinds, kinds
  4 and 10050 among them, and NIP-04/NIP-44 decrypt requests can be granted for `once` or `8h` only;
  unknown kinds and payments are always `once` (D11, D12). The background enforces these limits
  (`submitDecision`, `grantPermission`, `checkPermission`); the panel only offers them. A site's
  event kind must be a whole number from 0 to 65535.
- A site signs as the account it was first approved for, whichever account is active. Asking never
  binds a site: it is bound only when the user approves one of its requests (`bindSiteToAccount`).
  Only the user, from Porwr's own UI, moves a site to another account, and moving it revokes its
  grants. A pending request is never re-targeted to another account, and removing an account
  removes its grants and bindings.
- Porwr signs a client's zap request (kind 9734) and pays its invoice through WebLN, each only
  after approval. It never builds a zap request or fetches an invoice itself.

**Secrets**

- Private keys exist in plaintext only inside the unlocked vault in the background, and briefly on
  Porwr's own pages when the user imports an nsec or shows a key. Showing a key
  (`accounts.revealSecret`) and exporting one (`accounts.exportEncrypted`) both need the vault
  password again; an export is a NIP-49 `ncryptsec` made in the background, and an `ncryptsec` import is decrypted there, so neither puts a plaintext key
  on a page. The vault and export passwords have a minimum (`MIN_PASSWORD_LENGTH`) enforced in the
  background. A website learns only whether an operation succeeded, never vault contents.
- State that decides what a site may do (grants, site bindings, the auto-lock timeout and last
  activity) lives in the protected store (`src/services/protected-settings.ts`, the extension's own
  IndexedDB), never in `chrome.storage.local`, which Porwr's content scripts can read and write.
- Queue persistence in `chrome.storage.session` is metadata only. Event content, plaintext,
  ciphertext, and invoices stay in service-worker memory (D6).
- Never write keys, plaintext, or event content to logs, storage, error messages, or anything
  that leaves the device, and do not add analytics or telemetry.
- Only user interaction with Porwr's own surfaces resets the auto-lock timer. A site's requests
  never keep the vault unlocked (D15).

**Network**

- Relays are `wss:` only; plaintext `ws:` is allowed only to `localhost` and `127.0.0.1`. Check every
  relay URL with `isAllowedRelayProtocol` or `normalizeRelayUrl` (`src/services/relay-url.ts`)
  before connecting to it.
- Every other remote request, a Blossom upload included, goes over `https:`. A Blossom upload is
  authorised by one BUD-11 token scoped to the server and expiring within minutes.
- The one exception is the wallet-connect popup for a self-hosted Alby Hub (workspace#149). It may
  open an `http:` address only when `isLocalNetworkHost` (`src/types/wallet-provider.ts`) accepts
  the host, because home servers such as Umbrel serve Alby Hub without TLS. The page warns first,
  and Porwr itself still sends nothing to that address. Any other custom address must be `https:`.
  The accepted risk, that a device on the same network can read the user's Hub login and forge the
  Hub's reply, is T35 in `docs/threat-model.md`.
- NIP-47 requests use NIP-44 whenever the wallet advertises it.
- Show an image that a profile or relay names only through `RemoteImage`
  (`src/components/shared/RemoteImage.vue`), never an `<img>` or `<q-img>` that binds its own
  `src`. It holds the image back while "Load remote images" is off (T32), and
  `tests/unit/no-remote-resources.test.ts` fails on any other bound image.

**Manifest and dependencies**

- Do not add host permissions or `all_frames`, widen `web_accessible_resources`, or loosen the
  content security policy without a recorded decision. That includes `connect-src` and `img-src`,
  which keep connections on `https:`, `wss:`, and loopback `ws://localhost:*`,
  `ws://127.0.0.1:*`, `http://localhost:*` and `http://127.0.0.1:*` (the `http:` pair for a
  loopback relay's NIP-11 document, never followed by redirects), and images on `https:`
  (`src-bex/manifest-csp.ts` explains each directive). Content scripts run in top-level documents
  only.
- Every new runtime dependency ships to users with access to keys. Justify it in the pull request,
  and review the lockfile change.

## Workflow

- **Branches.** The base branch is `master`. Name branches by type, such as `feature/<slug>`,
  `fix/<slug>`, or `docs/<slug>`. When you work in a git worktree, put it beside the clone (for
  example `porwr/source-<branch-slug>/`), never inside another repository.
- **Commits and pull requests.** Pull requests are squash-merged, so the pull request title becomes
  the commit on `master`. It must be a [Conventional Commit](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:` and so on), because release-please
  reads it to choose the next version and write the changelog.
- **Tracking.** A pull request names the issue it closes, for example
  `Fixes diogel-io/workspace#<n>`, and goes in that issue's version milestone.
- **Review.** Code owners (`.github/CODEOWNERS`) review every pull request. Branch protection
  requires the CI `build` check to pass.
- **Releases.** release-please opens a `chore(release): <version>` pull request; merging it tags,
  builds, and publishes both browser stores. Never edit `CHANGELOG.md`, the `package.json` version,
  or `.release-please-manifest.json` by hand. See [DEPLOYMENT.md](DEPLOYMENT.md).

## What belongs in this repository

Code, tests, CI, release automation, and documentation that governs this repository (this file,
`CODINGSTANDARDS.md`, `DEVELOPING.md`, `DEPLOYMENT.md`, `README.md`, `PRIVACY.md`, `SECURITY.md`,
and the threat model in `docs/`) live here.
Product requirements, design, research, ADRs, and release planning live in the Diogel workspace.

## Keeping this file current

A pull request that changes a path, command, flow, or rule described here updates this file in
the same pull request, and one that adds, moves, or removes a security-sensitive path updates the
list in `SECURITY.md`. Stale guidance here is a defect.
