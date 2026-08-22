# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Diogel is a Quasar/Vue 3 browser extension (BEX target) implementing a NIP-07-compatible
`window.nostr` provider. It injects a provider into web pages, routes signing/encryption
requests through a background service worker, enforces per-origin permission rules, and signs
using a Nostr identity stored in an encrypted local vault. The UI (account/vault/relay/settings
management) is built with Vue 3 + Pinia + Quasar components.

## Commands

- Install: `npm install` (npm lockfile is canonical; `postinstall` runs `quasar prepare`)
- Dev (BEX, Chrome): `npm run dev` → `quasar dev -m bex -T chrome`
- Build SPA: `npm run build`
- Build BEX: `npm run build:chrome` / `npm run build:firefox`
- Lint: `npm run lint` (add `-- --fix` to autofix)
- Format: `npm run format` (Prettier 3, honors `.gitignore`)
- Typecheck: `npm run typecheck` (`vue-tsc --noEmit`, strict mode)
- Tests (watch): `npm run test`
- Tests (single run): `npm run test:run`
- Tests (coverage): `npm run test:coverage`
- Single test file: `npx vitest run tests/unit/services/auto-lock.test.ts`
- Single test by name: `npx vitest run -t "test name pattern"`
- BEX icons are committed and need no build step. Regenerate only if the source artwork changes; see README.

Use a Node version from `engines.node` in `package.json` (`^20 || ^22 || ^24 || ^25 || ^26 || ^28`).

## Architecture

### Message flow (web page → background → vault)

1. `src-bex/content-script.ts` injects `src-bex/nostr-provider.js` into the page (provides
   `window.nostr`) and relays `window.postMessage` traffic via
   `src-bex/window-message-handler.ts` (origin/security checks in
   `window-message-security.ts`).
2. The content script's bridge forwards requests to `src-bex/background.ts`, the BEX service
   worker / extension background.
3. `background.ts` registers handlers for every Bridge event (declared via the
   `BexEventMap` augmentation), enforces approval/permission flow (`requestApproval`,
   `handlers/permission-handler.ts`), resets the auto-lock timer, logs activity via
   `src/services/log-service.ts`, then calls `dispatchMessage` (`src-bex/dispatcher.ts`).
4. `dispatcher.ts` is the single switch-statement router from `BridgeAction` →
   handler in `src-bex/handlers/*` (vault, nip04, nip07, nip44, blossom, relay-browser,
   permissions, active-key). It is shared by both the Quasar BEX bridge and the raw
   `chrome.runtime.onMessage` listener.
5. Vault state itself (encryption, lock/unlock, account storage) lives in
   `src-bex/vault.ts`, with persistence through `src/services/storage-service.ts` /
   `dexie-storage.ts` / `database.ts` (Dexie/IndexedDB).

When adding a new `window.nostr` capability: add the type to `BridgeRequestMap`/
`BexEventMap` in `src/types/bridge.ts` and `background.ts`, add a case in
`dispatcher.ts`, implement the handler in `src-bex/handlers/`, and wire the
provider-side call in `nostr-provider.js`.

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
- Import shared code by alias, not by a relative path: `components/`, `src/stores/`,
  `src/services/`, `src/composables/`. A page that reaches out with `../` breaks the next
  time it moves between surface directories.
- Components in `src/components/` follow the same surface split, one convention throughout:
  `sidebar/`, `dashboard/` (with `dashboard/key-management/` for that feature group),
  `extension/`, and `shared/` for the three components more than one surface reaches
  (`DiogelLogo`, `AccountDropdown`, `ProfileView`). No component sits at the top level.
  A component used by a second surface moves to `shared/` rather than being imported across
  surface directories.
- Import components by alias — `components/<surface>/<Name>.vue` — never by a relative path.
  Tests live in `tests/`, not beside the component.
- Boot files (`src/boot/i18n`, `src/boot/axios`) are auto-registered by Quasar; don't
  import them directly elsewhere. Centralize HTTP via `src/boot/axios`.
- i18n messages live under `src/i18n/en-US`; the unplugin only picks up files under
  `src/i18n/`.

## TypeScript conventions and testing

See [CODINGSTANDARDS.md](CODINGSTANDARDS.md) for lint/format, TypeScript discipline,
testing conventions, and Domain-Driven Design standards.
