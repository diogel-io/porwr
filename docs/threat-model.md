# Porwr Threat Model

Status: current

Baseline: `diogel-io/porwr` `master` at `8ad26d5`

Tracking issue: diogel-io/workspace#135

This is the threat model for the whole Porwr extension. It supersedes the workspace approval threat
model (`10-products/porwr/architecture/approval-threat-model.md` in `diogel-io/workspace`, written
at `867eaa6` under #111) as the description of current behaviour. That document is kept as the
historical record of the approval path before the sidebar, request queue, and site binding work;
where the two differ, this document wins. Threat IDs T1-T13 and findings F1-F4 keep their original
meaning so that references to them stay valid.

Decision labels D1-D17 refer to the sidebar request lifecycle ADR. The decisions that bind code are
restated under "Security invariants" in [AGENTS.md](../AGENTS.md).

## How to read and maintain this document

- A pull request that adds an asset, a trust boundary, or a control, or that changes one listed
  here, updates this document in the same pull request. The security review checklist in
  `SECURITY.md` applies to every change touching a security-sensitive path.
- Paths are cited as they exist at the baseline commit. When the baseline moves, re-verify the rows
  you touch and update the baseline line above.
- **Disclosure rule.** This repository is public. A closed finding is described in full. An open
  finding that could be exploited is given a one-line summary and a tracking reference only; its
  details are held in a private GitHub security advisory on `diogel-io/porwr` and in the private
  workspace issue, and are published here once a fixed version is released. Report suspected
  vulnerabilities privately as described in `SECURITY.md`, never in a public issue.

## Scope and method

Porwr is a Manifest V3 browser extension built for Chrome (service worker background, side panel)
and Firefox 115+ (event page background, `sidebar_action`). Both builds share the code at the
baseline commit; target-specific behaviour is noted where it matters.

The model covers everything in the extension: the `window.nostr` and `window.webln` page surface,
approval and grants, the vault and its cryptography, key generation, import and export, backups,
auto-lock, NIP-17 messaging, relay transport, the NIP-47 wallet connection, Blossom uploads, local
logs and history, the manifest, and the build and release supply chain.

It was built by reading the paths named in each row at the baseline commit and the tests that
exercise them. It does not defend against an attacker who already controls the operating system,
the browser binary, or the user's unlocked browser profile with developer tools or debugger access.

## 1. Assets

| Asset                                | Where it lives                                                                                                                                                                                                        | Why it matters                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Private keys and the encrypted vault | Dexie database `DiogelDatabase`, table `vaults`, row `master` (`src/services/database.ts`). AES-256-GCM under a PBKDF2-SHA-256 key, 600,000 iterations, 32-byte salt, 12-byte IV per write (`src/services/crypto.ts`) | Compromise is unrecoverable; a Nostr identity has no rotation story                |
| Vault session key                    | A non-extractable `CryptoKey` in the Dexie `vaultSession` table, plus the `vault:unlocked` marker in `chrome.storage.session` (`src-bex/vault.ts` `saveKeyToSession`, `restoreVaultState`)                            | Holds the unlocked state across service-worker restarts                            |
| Signing capability while unlocked    | Background, through `getVaultData` and `resolveSigningSecretKey` (`src-bex/services/signing-account.ts`)                                                                                                              | An attacker does not need the key if they can cause signatures                     |
| Permission grants                    | `nostr:permissions`, keyed by origin, account, request type, and kind (`src-bex/handlers/permission-handler.ts`)                                                                                                      | A grant is a standing authorisation to sign, encrypt, or decrypt without prompting |
| Site-to-account bindings             | `nostr:site-bindings` (`src-bex/services/site-binding-store.ts`)                                                                                                                                                      | Decides which identity a site signs as                                             |
| WebLN permissions                    | Inside the encrypted vault (`src-bex/services/webln-permission-store.ts`)                                                                                                                                             | Lets a site request payments                                                       |
| Request queue metadata               | `chrome.storage.session` (`src-bex/services/request-queue.ts` `toDurableRecord`)                                                                                                                                      | Reconciliation data; must never become an approval channel                         |
| Event content, plaintext, invoices   | Service-worker memory only, for the life of a request (`requestContent` in `request-queue.ts`)                                                                                                                        | Reveals what the user says, to whom, and what they pay                             |
| Decrypted direct messages            | Memory only in `Nip17Messaging` (`src-bex/services/nip17-messaging.ts`), cleared on lock and account change                                                                                                           | Private conversation content                                                       |
| NIP-47 wallet connection secret      | Inside the encrypted vault (`src-bex/services/nip47-connection-store.ts`); a pending authorisation's secret in `chrome.storage.session` for up to 10 minutes (`nip47-pending-authorization-store.ts`)                 | Spends from the user's wallet                                                      |
| Encrypted backups and exports        | Whole-vault backup: the stored vault ciphertext as JSON (`src/composables/useVaultManagement.ts`, `src/services/vault-backup-download.ts`). Per-key export: a password-protected zip (`src/services/compressor.ts`)   | Leave the extension's protection and live on the user's disk                       |
| Approval and activity history        | Dexie `approvals` and `exceptions` tables (`src/services/log-service.ts`)                                                                                                                                             | Reveals which sites the user transacts with                                        |
| Vault password                       | Never stored; passed from Porwr's own pages to the background for create, unlock, and import                                                                                                                          | Unlocks every key                                                                  |

## 2. Trust boundaries

| #   | Boundary                                          | Enforcement at the baseline                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Web page ↔ injected provider                      | `window.postMessage` with `event.source === window`, same-origin, and shape checks (`src-bex/window-message-security.ts`, `src-bex/window-message-handler.ts`). Only methods in `PAGE_METHOD_TO_ACTION` (`src-bex/page-actions.ts`) are forwarded, and no origin is sent                                                                                                             |
| B2  | Content script ↔ background over `porwr:page`     | The requesting site comes only from the port's browser-supplied sender: `sender.origin` on Chromium, the origin of `sender.url` on Firefox (`pageOriginOf` in `src-bex/services/sender-policy.ts`). `src-bex/services/page-channel.ts` strips `origin` and `approved` from payloads, refuses a sender that names no http(s) site, and serves only the page allowlist                 |
| B3  | Background ↔ Porwr's own pages (panel, dashboard) | The raw `chrome.runtime.onMessage` listener accepts only senders classified `extension-page` and refuses every origin-scoped action from them (`classifySender` in `sender-policy.ts`, `decideRouting` in `src-bex/services/message-routing.ts`). The Quasar bridge serves only `ping`. The panel is untrusted for lifecycle purposes and decides only against a request id (D1, D5) |
| B4  | Background ↔ storage                              | Vault encryption at rest; `chrome.storage.session` restricted to trusted contexts (`lockDownSessionStorage` in `src-bex/background.ts`); queue persistence limited to metadata (D6). See F6                                                                                                                                                                                          |
| B5  | Extension ↔ relays, Blossom servers, wallets      | Relay URLs normalised by `src/services/relay-url.ts`; NIP-42 AUTH signs only kind 22242 (`src-bex/services/relay-auth.ts`); NIP-47 requests are signed with the connection's own client key, never the user's Nostr key (`src-bex/services/nip47-client.ts`)                                                                                                                         |
| B6  | Extension ↔ browser panel APIs                    | The panel opens only from the toolbar gesture (`src-bex/services/panel-surface.ts`, `action.onClicked` in `background.ts`); no approval popup or automatic opening exists (D3, D4, D17)                                                                                                                                                                                              |

B2 is the load-bearing boundary for the page surface. The content script declares no `all_frames`
(`src-bex/manifest.json`), so the provider runs in top-level documents only and a third-party iframe
cannot raise a request under the embedding site's origin.

## 3. Adversaries

| #   | Adversary                             | Capability assumed                                                                                                                        |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Malicious or compromised website      | Calls every allowlisted `window.nostr` and `window.webln` method at any rate, with crafted content; may hold grants the user gave earlier |
| A2  | Third-party iframe or embedded script | Runs inside a page the user trusts, in a subframe or in the top frame through an included script                                          |
| A3  | Another extension                     | Can message Porwr through `chrome.runtime` and inject into the same pages; has no debugger access                                         |
| A4  | Malicious relay or Blossom server     | Observes what Porwr sends, returns crafted events and responses, requests NIP-42 AUTH                                                     |
| A5  | Local access to the browser profile   | Reads files of a locked profile, or sits at an unlocked browser for a short time; cannot install software                                 |
| A6  | Compromised build or dependency       | Controls a runtime dependency, a build tool, or a CI action                                                                               |
| A7  | Phishing and look-alike origins       | Controls a domain visually similar to one the user trusts, or persuades the user outside the product                                      |

## 4. Threats and controls

### Carried over from the approval threat model

| ID  | Threat                                                                                           | Control at the baseline                                                                                                                                                                                                                         | Owner                | Residual risk                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | The panel shows an origin the request did not come from, so the user approves for the wrong site | Origin from the port sender (B2); the panel renders the request's own origin, never the active tab's, and warns on `http:` (`src/components/sidebar/RequestOriginHeader.vue`)                                                                   | D2, #112, #115, #246 | No explicit punycode or look-alike handling. IDN hosts appear as `xn--` only because the browser serialises them that way (open item 1) |
| T2  | The signing identity changes under a site because the user switched account                      | A site signs as its bound account, whatever account is active (`resolveSigningAccount` in `signing-account.ts`); fails closed if that account is gone; only the user rebinds, and rebinding revokes grants (`src-bex/services/site-account.ts`) | #116                 | The binding is written when a site first asks, before approval (F5)                                                                     |
| T3  | A decision applies to the wrong request, or a request resolves twice                             | `crypto.randomUUID` request ids; `submitDecision` refuses unknown, terminal, and expired ids; each callback settles once                                                                                                                        | D5, #114             | Low                                                                                                                                     |
| T4  | A request outlives its page or a worker restart and is signed for nobody                         | Callbacks are memory-only; `reconcileInterruptedRequests` at startup and `interruptRequestsForOrigin` when no tab holds the origin settle requests as `interrupted`                                                                             | D7, #114             | The provider gives up after 30 s while the request stays approvable until expiry; the result is then posted to a page nobody awaits     |
| T5  | Queue persistence writes event content or decrypted material to disk                             | `toDurableRecord` keeps a fixed field list; content is held in memory and dropped when the request ends; the queue is in trusted-context session storage                                                                                        | D6, #114             | Low; asserted by tests                                                                                                                  |
| T6  | A closed panel hides requests, and habituation leads to approving without reading                | Passive badge count, no automatic opening, expiry from creation, nothing beyond `once` pre-selected                                                                                                                                             | D4, D8, #113         | A user may still approve a stale-feeling request after reopening the panel                                                              |
| T7  | An approval leaks the browsing or transaction relationship to a third party                      | The panel renders the origin from the string only; no favicon, title, profile, or NIP-05 lookup runs while a request is shown                                                                                                                   | D13, #115            | Closed in code (F3); no test asserts it (diogel-io/workspace#144)                                                                       |
| T8  | Unlocking the vault is treated as consent to the waiting request                                 | The locked view offers unlock or reject only; `requestApproval` still waits for an explicit decision                                                                                                                                            | D14, #115            | Closed in code; no dedicated test (diogel-io/workspace#144)                                                                             |
| T9  | A site keeps the vault unlocked indefinitely by making requests                                  | Only `vault.unlock` and `activity.mark` from Porwr's own pages reset the timer (`src-bex/dispatcher.ts`, `src/composables/useVaultAutoLock.ts`)                                                                                                 | D15                  | Closed for page requests (F2). See also F6                                                                                              |
| T10 | A grant obtained for a low-impact request authorises high-impact signing later                   | Grants are keyed by request type and kind, so a non-signing grant cannot answer a signing request (F1 closed); kind risk classes limit durations (`src/services/approval-preview.ts`)                                                           | D12, #115            | The duration limit is not enforced by the background, and decrypt grants are not scoped to a counterparty (F5)                          |
| T11 | Logs reveal event content or key material                                                        | `wrapWithLogging` records argument counts and result types only; DEBUG and INFO run only in tests; no analytics                                                                                                                                 | #87                  | Approval history keeps hostnames indefinitely (T28); no test asserts that logs exclude content (diogel-io/workspace#144)                |
| T12 | The user cannot tell what a signature does, because the preview is truncated or absent           | Formatted, raw, and full-event views; truncation at 600 characters is reported with an expand control; unknown kinds open on the full event                                                                                                     | D12, #115            | Low                                                                                                                                     |
| T13 | The expiry window is widened until it stops being a control                                      | `clampRequestExpiryMinutes` bounds the setting to 1-10 minutes (`src/services/request-expiry.ts`) and the effective value is stamped on each request at creation                                                                                | D8, #112, #114       | An attacker with storage access can still choose the ceiling                                                                            |

### Added for the whole extension

| ID  | Threat                                                                             | Control at the baseline                                                                                                                                                                                                                      | Owner                                 | Residual risk                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T14 | An attacker with a copy of the vault or a whole-vault backup recovers keys offline | AES-256-GCM with a fresh IV per write; PBKDF2-SHA-256 at 600,000 iterations with a 32-byte salt; the derived key is non-extractable; the backup is the stored ciphertext, not a re-encoding                                                  | `src/services/crypto.ts`              | Strength rests on the password (F7, diogel-io/workspace#141)                                                                                               |
| T15 | The unlocked state is stolen or outlives the browser session                       | The session key is a non-extractable `CryptoKey`; raw key bytes are never written to session storage and legacy ones are deleted; a browser restart finds no marker and deletes the key; session storage is restricted to trusted contexts   | #83, #245                             | Accepted: a Porwr page can use, but not export, the key while unlocked. JavaScript cannot zero key bytes held in memory                                    |
| T16 | Weak, predictable, or malformed keys are generated or imported                     | Keys are generated in the background with `nostr-tools` `generateSecretKey`; imports must be 64-character lowercase hex in the background, and the import form decodes `nsec` before sending it once                                         | `src-bex/handlers/accounts.ts`        | Low                                                                                                                                                        |
| T17 | A private key leaves Porwr in a weakly protected form                              | `accounts.revealSecret` is the only action that returns a key, and only to Porwr's own pages; it is not reachable from websites                                                                                                              | #240                                  | Accepted: reveal does not ask for the password again. Export is open (F7, diogel-io/workspace#141)                                                         |
| T18 | Auto-lock is disabled or bypassed                                                  | 15-minute default; the timer resets only on Porwr UI activity (T9); after a worker restart the persisted last-activity time is checked before use                                                                                            | D15                                   | The user may set auto-lock to 0. See F6 (diogel-io/workspace#140)                                                                                          |
| T19 | A network observer reads or alters relay traffic                                   | Signed events cannot be altered without detection; seed and fallback relays are `wss:`                                                                                                                                                       | diogel-io/workspace#142               | `ws:` relay URLs are accepted and NIP-11 then uses `http:`, exposing metadata such as which pubkeys are queried                                            |
| T20 | A relay obtains signatures through NIP-42 AUTH                                     | `authSigner` signs kind 22242 only and refuses every other kind; read pools are never given an AUTH signer; the DM relay probe uses a throwaway key                                                                                          | `src-bex/services/relay-auth.ts`      | AUTH is signed without a prompt, including on a recipient's inbox relays when sending a DM, which reveals the sender's pubkey to those relays              |
| T21 | A Blossom server replays or misuses an upload authorisation                        | Uploads run only from the dashboard after the user picks a file; the auth event carries the file hash, method, size, and URL                                                                                                                 | diogel-io/workspace#142               | The auth event has no `expiration` or `server` tag, is signed outside the approval queue, and the server URL is not validated                              |
| T22 | The wallet connection is stolen or a payment is made without consent               | The client secret is generated in the background and stored in the vault; pages see only `hasClientSecret`; each website payment needs a fresh `once` approval and no grant is ever written for it; the wallet is the bound account's        | D11, #304                             | NIP-47 traffic uses NIP-04 only; a pending authorisation's secret survives a vault lock for up to 10 minutes; `webln.getInfo` needs no prompt once enabled |
| T23 | Porwr originates or redirects a zap                                                | Porwr only signs a client's kind 9734 zap request, as an elevated kind (`once` or `8h`, never `always`), and pays the client's invoice through WebLN after a separate approval; it never builds a zap request or fetches an LNURL or invoice | D12                                   | An 8-hour grant for kind 9734 is possible by design                                                                                                        |
| T24 | Decrypted direct messages reach disk                                               | Decrypted messages are held in memory and cleared on lock and account change; read state and saved peers live inside the encrypted vault                                                                                                     | `src-bex/services/nip17-messaging.ts` | Low                                                                                                                                                        |
| T25 | Another extension drives Porwr                                                     | `classifySender` treats any other extension as foreign and the raw listener refuses it; the page channel accepts only Porwr's own content script                                                                                             | #240, #246                            | An extension that injects script into a page acts as that page (A1), within that page's grants                                                             |
| T26 | Someone with local access reads secrets or acts through an unlocked browser        | The vault is encrypted at rest; a locked profile exposes ciphertext only; auto-lock limits the unlocked window                                                                                                                               | D15                                   | Accepted: an unlocked vault can be used by anyone at the browser until it locks. Approval history and grants are readable from a locked profile            |
| T27 | A dependency, build tool, or CI action is compromised                              | `npm ci` from a committed lockfile; `allowScripts` limits install scripts; the release builds deterministic archives, checks the tag against the version, and publishes from a draft release; `nak` in the e2e workflow is SHA-256 verified  | diogel-io/workspace#143               | Unused runtime dependencies ship; most actions are tag-pinned; workflows lack least-privilege `permissions:`; no dependency update automation              |
| T28 | Local history reveals the user's browsing and transactions                         | Approval history stores kind, hostname, account alias, and outcome only; no analytics or telemetry                                                                                                                                           | diogel-io/workspace#144               | `approvals` and `exceptions` have no retention limit                                                                                                       |
| T29 | Security state is tampered with outside the background                             | Grants and bindings are validated when read, and malformed records are dropped                                                                                                                                                               | diogel-io/workspace#140               | Open (F6)                                                                                                                                                  |
| T30 | A site fingerprints the user as a Porwr user                                       | None: `window.nostr.name` is `Porwr` and `web_accessible_resources` are exposed at a fixed URL                                                                                                                                               | Accepted                              | Revealing that a NIP-07 signer is installed is inherent to NIP-07                                                                                          |
| T31 | Error messages tell a site more than it was granted                                | Errors carry no key material or content                                                                                                                                                                                                      | Accepted                              | A site can learn without a prompt whether the vault is locked, and tell "locked" from "rejected"                                                           |

### Not implemented

**NIP-46 (Nostr Connect, remote signers).** Porwr has no NIP-46 client or signer at the baseline; the
only references are the kind 24133 label and an unused `nip46` field in the NIP-05 response type.
Implementation is tracked in diogel-io/workspace#138. Before it ships, this document must gain a
threat entry covering relay observation of NIP-46 traffic, a malicious or compromised remote signer,
theft of the connection secret, forged or replayed responses, and `auth_url` challenges under D13.

## 5. Security requirements

These properties hold at the baseline and every change must preserve them. Requirements 1-9 are
carried over from the approval threat model.

1. A signature is produced only after an explicit user decision on a live request, or under a grant
   that covers that request type and event kind.
2. Unlocking never approves.
3. A request whose live callback is lost can never be approved.
4. An expired request can never be approved, and no setting disables expiry or raises it above the
   compiled ceiling.
5. One request resolves exactly once.
6. The request queue writes no event content, plaintext, ciphertext, invoice, or key material to
   storage.
7. No remote resource is requested as part of an approval.
8. The user sees the requesting origin and the signing account before any approval control.
9. Rejecting is possible in every recoverable state without unlocking first.
10. The requesting origin comes only from the browser-supplied sender, never from a payload.
11. A website reaches only the page allowlist; vault, account, wallet, and decision actions are
    reachable only from Porwr's own pages.
12. A private key leaves the background only through `accounts.revealSecret`, to Porwr's own pages.
13. A payment is always approved once, and never under a stored grant.
14. Porwr never builds a zap request or fetches an invoice itself.

## 6. Findings

### Closed

**F1 - A public-key grant authorised signing of any event kind.** Closed. At `867eaa6` a stored
grant of kind `-1` meant "no event kind" at the approval call sites and "any kind" in the checker,
so approving a public-key request with "always" authorised signing anything. Grants are now keyed by
request type as well as kind; "no event kind" maps to `null`, not a wildcard (`toPermissionKind` in
`src-bex/services/approval-flow.ts`); a wildcard answers only `sign_event` and cannot be created by
`grantPermission`; legacy records are discarded (`src-bex/handlers/permission-handler.ts`). Tests:
`tests/unit/handlers/permission-handler.test.ts` ("does not let a public-key grant authorise
signing", "cannot be created through grantPermission"), `tests/unit/services/approval-flow.test.ts`.

**F2 - Site activity kept the vault unlocked.** Closed. Every bridge handler used to reset the
auto-lock timer. `resetAutoLockTimer` is now called only on `vault.unlock` and `activity.mark`
(`src-bex/dispatcher.ts`), both reachable only from Porwr's own pages. Tests:
`tests/unit/handlers/nip07.test.ts`, `tests/unit/handlers/nip44.test.ts` (assert no reset on site
requests), `tests/unit/services/auto-lock.test.ts`.

**F3 - Approval disclosed the requesting site to a third party.** Closed. The approval screen used to
load a favicon from a Google endpoint. `RequestOriginHeader.vue` now renders the origin string with
locally drawn initials, and no sidebar component loads a remote resource. No test asserts this yet
(diogel-io/workspace#144).

**F4 - Approval responses carried no request identity.** Closed. `nostr.requests.respond` carries a
`requestId` and `submitDecision` refuses unknown, terminal, and expired ids. Tests:
`tests/unit/services/request-queue.test.ts`, `tests/unit/dispatcher-routing-table.test.ts`,
`tests/e2e/fail-closed.spec.ts`.

### Open

Open findings are summarised under the disclosure rule above. The tracking issues are in the private
workspace repository.

| ID  | Summary                                                                                          | Severity | Tracking                                  |
| --- | ------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------- |
| F5  | Some grant and binding limits are enforced only in the UI or are not cleaned up with their owner | Medium   | diogel-io/workspace#139                   |
| F6  | Some security state is stored where it is less protected than it should be                       | Medium   | diogel-io/workspace#140, private advisory |
| F7  | The per-key export format and the vault password rule are weaker than the vault itself           | Medium   | diogel-io/workspace#141, private advisory |
| F8  | Relay, Blossom, and NIP-47 transport lack hardening the approval path has                        | Low      | diogel-io/workspace#142                   |
| F9  | Supply-chain and CI controls are incomplete                                                      | Low      | diogel-io/workspace#143                   |
| F10 | Several controls lack a test, and local history has no retention limit                           | Low      | diogel-io/workspace#144                   |

## 7. Accepted risks

- **Session key across worker restarts (#83, #245).** The unlocked state survives a service-worker
  restart as a non-extractable `CryptoKey` in extension IndexedDB, gated by a session-storage marker
  that the browser clears on exit. A Porwr page can use the key while the vault is unlocked; nothing
  can export it.
- **Logging policy (#87).** Logs record structure, not content. WARN and ERROR messages go to the
  console and the `exceptions` table.
- **No product analytics or telemetry.** Privacy is preferred over rollout measurement.
- **Reveal without re-authentication (#240).** Showing or exporting a key requires an unlocked
  vault, not the password again.
- **No memory zeroisation.** JavaScript gives no reliable way to erase key bytes; keys are decrypted
  per operation rather than cached in module state.
- **Fingerprinting and lock-state disclosure (T30, T31).** Inherent to NIP-07 as specified.
- **User-disabled auto-lock.** A user may set auto-lock to 0; the protection is then the browser
  session alone.

## 8. Verification hooks

Each control below must be covered by an automated test, not by review alone.

| Hook                                                                        | Threats  | Test                                                                                                                          |
| --------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| The origin comes from the sender, never the payload                         | T1       | `tests/unit/services/sender-policy.test.ts`, `tests/unit/services/page-channel.test.ts`, `tests/e2e/untrusted-sender.spec.ts` |
| A subframe cannot relabel its tab                                           | T1       | `tests/unit/services/page-origin-registry.test.ts`                                                                            |
| A site keeps its bound account after the active account changes             | T2       | `tests/unit/services/signing-account.test.ts`, `tests/e2e/site-account-mismatch.spec.ts`                                      |
| Unknown, terminal, and expired request ids are refused                      | T3, T4   | `tests/unit/services/request-queue.test.ts`, `tests/e2e/fail-closed.spec.ts`                                                  |
| A restarted worker cannot approve a request whose callback was lost         | T4       | `tests/unit/services/request-queue.test.ts`, `tests/e2e/fail-closed.spec.ts`                                                  |
| The durable queue record holds only permitted fields                        | T5       | `tests/unit/services/request-queue.test.ts`, `tests/unit/services/request-content.test.ts`                                    |
| No approval fallback surface or automatic opening exists                    | T6       | `tests/unit/sidebar-surface-boundary.test.ts`, `tests/unit/panel-open-gesture.test.ts`                                        |
| The panel makes no network request while a request is shown                 | T7       | Missing (diogel-io/workspace#144)                                                                                             |
| Unlock without a decision does not resolve a request                        | T8       | Missing (diogel-io/workspace#144)                                                                                             |
| Site requests do not reset auto-lock                                        | T9       | `tests/unit/handlers/nip07.test.ts`, `tests/unit/handlers/nip44.test.ts`                                                      |
| A non-signing grant does not satisfy a signing check                        | T10      | `tests/unit/handlers/permission-handler.test.ts`                                                                              |
| The background refuses a duration the risk class does not allow             | T10      | Missing (diogel-io/workspace#139)                                                                                             |
| A payment request cannot produce a stored grant                             | T10, T22 | `tests/unit/services/approval-flow.test.ts`, `tests/unit/services/approval-preview.test.ts`                                   |
| Logs exclude content                                                        | T11      | Missing (diogel-io/workspace#144)                                                                                             |
| Truncation is reported, never silent                                        | T12      | `tests/unit/services/approval-preview.test.ts`, `tests/unit/services/approval-flow.test.ts`                                   |
| Expiry is clamped and stamped at creation                                   | T13      | `tests/unit/services/request-expiry-bounds.test.ts`, `tests/unit/services/request-queue.test.ts`                              |
| Vault encryption uses a fresh IV and rejects tampering                      | T14      | `tests/unit/vault.test.ts`                                                                                                    |
| The session key cannot be exported and does not outlive the browser session | T15      | `tests/unit/vault-session.test.ts`                                                                                            |
| Session storage is restricted to trusted contexts                           | T15, T5  | Missing (diogel-io/workspace#144)                                                                                             |
| Keys are generated in the background and only a summary is returned         | T16, T17 | `tests/unit/handlers/accounts.test.ts`, `tests/unit/guards/no-secrets-in-responses.test.ts`                                   |
| Import checks the password before it writes                                 | T14      | `tests/unit/vault.test.ts`                                                                                                    |
| NIP-42 AUTH signs kind 22242 only                                           | T20      | `tests/unit/services/nip17-messaging.test.ts`, `tests/unit/services/dm-relay-probe.test.ts`                                   |
| The NIP-47 client secret never reaches a page                               | T22      | `tests/unit/handlers/nip47.test.ts`                                                                                           |
| A zap request is signed only through `window.nostr`, with no Porwr zap API  | T23      | `tests/unit/nostr-provider-webln.test.ts`, `tests/unit/services/approval-preview.test.ts`                                     |
| Decrypted messages are dropped on lock                                      | T24      | `tests/unit/services/nip17-messaging.test.ts`, `tests/unit/handlers/messaging.test.ts`                                        |
| Other extensions and content scripts are refused on the raw listener        | T25      | `tests/unit/services/message-routing.test.ts`, `tests/unit/services/sender-policy.test.ts`                                    |
| The manifest asks for no host permissions and the CSP allows only `'self'`  | T27      | `tests/unit/manifest-csp.test.ts`, `tests/unit/bex-manifest.test.ts`, `tests/e2e/extension-loads.spec.ts`                     |

## 9. Open items

1. Homograph and look-alike origins. Decide whether the panel displays punycode explicitly, marks
   mixed-script hosts, or takes no position beyond the browser's serialisation.
2. Whether NIP-04 and NIP-44 decrypt grants should be scoped to a counterparty (diogel-io/workspace#139).
3. Whether a dedicated security contact replaces the current address in `SECURITY.md`
   (diogel-io/workspace#136).
4. The #83 and #87 design notes are not mirrored into the workspace, so section 7 summarises rather
   than quotes them.

## References

- [AGENTS.md](../AGENTS.md), "Security invariants": the binding rules, with ADR labels.
- `SECURITY.md`: vulnerability reporting and the security review checklist (diogel-io/workspace#136).
- Workspace `10-products/porwr/architecture/approval-threat-model.md`: the historical approval-path
  model at `867eaa6`.
- Workspace `10-products/porwr/architecture/sidebar-request-lifecycle-adr.md`: decisions D1-D17.
- [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md),
  [NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md),
  [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md),
  [NIP-47](https://github.com/nostr-protocol/nips/blob/master/47.md),
  [NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md).
