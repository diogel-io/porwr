# Security Policy

Porwr holds Nostr private keys and signs on their behalf. This file explains how to report a
vulnerability, what counts as one, and the review every security-sensitive change must pass before
it merges. The threat model behind it is [docs/threat-model.md](docs/threat-model.md).

## Reporting a vulnerability

**Do not open a public issue, discussion, or pull request for a suspected vulnerability.**

Report it privately:

1. **Preferred:** use GitHub private vulnerability reporting. Open the repository's
   [Security tab](https://github.com/diogel-io/porwr/security) and choose **Report a
   vulnerability**.
2. **Alternative:** email support@threenine.co.uk with "Porwr security" in the subject.

Please include:

- the Porwr version, browser, and browser version;
- the steps to reproduce, and what you expected to happen instead;
- the impact: what an attacker gains and what they need first;
- a proof of concept if you have one. Never use a real private key or real funds in a report;
  generate a throwaway key.

What to expect:

| Step            | Target                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------- |
| Acknowledgement | Within 3 working days                                                                        |
| Triage          | Within 10 working days: we confirm or decline, and agree a severity                          |
| Fix and release | As fast as the severity needs; we keep you informed until it ships                           |
| Disclosure      | A GitHub security advisory when the fix is released, by default within 90 days of the report |

We credit reporters in the advisory unless you ask us not to. Please give us the chance to release a
fix before you disclose publicly.

## Supported versions

Only the latest release published on the Chrome Web Store and Firefox Add-ons receives security
fixes. Browser stores update extensions automatically, so a fix ships as a new release rather than
a patch to an older version.

| Version         | Supported |
| --------------- | --------- |
| Latest release  | Yes       |
| Any earlier one | No        |

## Scope

In scope: anything that defeats a Porwr control, for example

- exposure of a private key, a decrypted message, or other plaintext the vault or a request
  protects;
- a signature, encryption, decryption, or payment that happens without a standing grant or an
  explicit user decision;
- origin confusion: a request attributed to a site other than the one that made it;
- bypass of a permission grant, a site-to-account binding, or a kind risk class;
- bypass of the vault lock or auto-lock;
- secrets reaching logs, storage, error messages, or the network;
- a flaw in the build or release pipeline that could ship altered code.

Out of scope:

- an attacker who already controls the operating system, the browser binary, or the unlocked
  browser profile, including malicious extensions with debugger or devtools access;
- social engineering that happens outside Porwr, such as persuading a user to paste their key into
  a website;
- the accepted risks listed in the threat model, section 7, unless you show they are worse than
  stated;
- vulnerabilities in relays, wallets, or Blossom servers themselves, rather than in how Porwr uses
  them.

If you are unsure, report it anyway.

## Security review guidelines

A pull request that touches a sensitive path must pass this review before it merges. The rules
restate the security invariants in [AGENTS.md](AGENTS.md#security-invariants); labels such as D1
refer to the sidebar request lifecycle ADR, and T numbers to [the threat model](docs/threat-model.md).

### Sensitive paths

A change to any of these needs the security review:

- `src-bex/vault.ts`
- `src-bex/handlers/*`, every handler
- `src-bex/services/*`, in particular `sender-policy.ts`, `origin.ts`, `page-channel.ts`,
  `page-origin-registry.ts`, `message-routing.ts`, `request-queue.ts`, `approval-flow.ts`,
  `signing-account.ts`, `site-account.ts`, `site-binding-store.ts`, `connected-sites.ts`,
  `auto-lock.ts`, `vault-mutation.ts`, `wallet-vault.ts`, `relay-auth.ts`, `nip17-messaging.ts`,
  and the `nip47-*` stores
- `src-bex/background.ts`, `src-bex/dispatcher.ts`, `src-bex/content-script.ts`,
  `src-bex/page-port-client.ts`, `src-bex/window-message-handler.ts`,
  `src-bex/window-message-security.ts`, `src-bex/nostr-provider.js`, `src-bex/page-actions.ts`
- `src-bex/manifest.json`, `src-bex/manifest-csp.ts`, and the BEX settings in `quasar.config.ts`
- `src/services/crypto.ts`, `src/services/vault-service.ts`, `src/services/storage-service.ts`,
  `src/services/dexie-storage.ts`, `src/services/database.ts`, `src/services/log-service.ts`,
  `src/services/approval-preview.ts`, `src/services/request-expiry.ts`,
  `src/services/key-backup.ts`, `src/services/protected-settings.ts`,
  `src/services/auto-lock-minutes.ts`
- `src/components/sidebar/*` and `src/composables/useApprovalQueue.ts`, which present and decide
  requests
- `package.json`, `package-lock.json`, `src-bex/package.json`, `.npmrc`, and `.github/workflows/*`
- anything else that touches cryptography, key material, or persistence

### Checklist

**Origin**

- [ ] The requesting site comes only from the browser-supplied sender of the `porwr:page` port
      (`pageOriginOf`), never from a request payload. A sender that names no http(s) site is
      refused.
- [ ] A new `window.nostr` or `window.webln` capability is added to the page allowlist
      (`src-bex/page-actions.ts`) with its own `pageActionHandlers` entry. Nothing reaches
      `dispatchMessage` from a page any other way.
- [ ] The approval shows the request's own origin, never the active tab's, and loads nothing remote
      to present it (D2, D13).

**Consent**

- [ ] No signature, encryption, decryption, or payment a website requests happens without a
      standing grant or an explicit decision. There is no popup fallback and the panel never opens
      by itself (D3, D4).
- [ ] The background owns the request lifecycle. A decision naming an unknown, terminal, or expired
      request is refused (D1, D5).
- [ ] Unlocking the vault never approves a waiting request (D14).
- [ ] A request whose page callback is lost can never be signed; expiry stays an absolute cap,
      bounded and clamped by the background (D7, D8).
- [ ] Kind risk classes are respected: elevated kinds `once` or `8h` only; unknown kinds and
      payments `once` only (D11, D12).
- [ ] A site's account binding is never re-targeted silently. Only the user moves a site to
      another account, from Porwr's own UI, and moving it revokes its grants.

**Secrets**

- [ ] No key, plaintext, event content, ciphertext, or invoice reaches logs, error messages,
      persisted exceptions, `chrome.storage`, queue persistence, or the network (D6).
- [ ] A website learns only whether an operation succeeded, never vault contents. A private key
      leaves the background only through `accounts.revealSecret`, to Porwr's own pages.
- [ ] No remote lookup runs during approval, and no analytics or telemetry is added.
- [ ] Only user interaction with Porwr's own surfaces resets the auto-lock timer (D15).

**Manifest and permissions**

- [ ] No new host permission, `all_frames`, `web_accessible_resources` entry, or content security
      policy loosening without a recorded decision linked from the pull request.

**Dependencies and build**

- [ ] Every new runtime dependency is justified in the pull request, the lockfile change is
      reviewed, and nothing is added to the `dependencies` of `src-bex/package.json`.
- [ ] Workflow changes keep secrets out of logs and do not widen token permissions without a
      reason.

**Tests**

- [ ] Each new or changed control has a negative test, such as a spoofed origin, an expired or
      unknown request id, a locked vault, a disallowed duration, or a secret that must not appear
      in a response.
- [ ] For a change to the panel, the approval flow, or anything a page can reach, the end-to-end
      suites pass in both browsers (`npm run test:e2e`, `npm run test:e2e:firefox`).

**Threat model**

- [ ] [docs/threat-model.md](docs/threat-model.md) is updated in the same pull request when the
      change adds or changes an asset, a trust boundary, or a control. An open, exploitable
      weakness appears there only as a one-line summary with its tracking reference.

### Recording the review

1. The author ticks **Touches a sensitive path** in the pull request template and works through
   this checklist, marking any item that does not apply. A change that touches no sensitive path
   says so instead.
2. A code owner confirms the checklist in their review. Any item the change cannot meet needs a
   recorded decision linked from the pull request, and the decision comes first.
3. Agents apply the same checklist: the workspace `review-pr` skill checks it for any Porwr pull
   request that touches a sensitive path, and Claude Code's `/security-review` command applies it
   because [AGENTS.md](AGENTS.md) directs agents here.
