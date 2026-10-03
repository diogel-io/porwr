<a href="https://diogel.io" target="_blank"> <img alt="Diogel" src="https://res.cloudinary.com/threenine-co-uk/image/upload/v1733252921/diogel-header_dmv8n6.png" width="800"/></a>

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/inhkmeiabnknligdjngmoocohdonoboa?label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/nostrame/inhkmeiabnknligdjngmoocohdonoboa)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Diogel Porwr is a browser extension that injects a NIP-07-compatible `window.nostr` provider into web pages, 
routes requests through a background script, enforces per-origin approval rules, signs with the Nostr identity each
site connected with, stored inside an encrypted local vault, and provides a Vue/Pinia UI for account, vault, and settings

**Key Features:**

##### Multiple Identity Management

- Manage multiple identities
- Switch between identities
- Sign messages and posts
- Import existing keys or generate new ones
- Customize profiles with display names and metadata

##### Secure Key Storage

- Keys are stored in a password-protected encrypted vault with automatic locking.
- Keys never leave the extension because apps only receive signatures

#### NIP-07 Signing

- Full NIP-07 implementation (window.nostr interface)
- Review event details before signing
- Granular permission controls per site and event kind
- One-click approve or reject with "always" options

##### Sites keep the account they connected with

A site signs as the account that was active when it first connected, even after you select another
account in Porwr. A site caches the key it was given at sign-in, so following the active account
would change who it thinks you are without telling it.

When a site is connected as an account that isn't your active one, Porwr says so:

- **The panel**, for the site in the current tab: "Connected as <account>", a warning, and
  **Use <active account> for this site**.
- **The approval prompt:** "Not your active account", and **Reject and use <active account>**. That
  rejects the request (nothing is signed) and moves the site.
- **Connected Sites** in the dashboard marks the site "Not your active account".

Moving a site disconnects it, removing its standing permissions, and connects it as the active
account. Sign out of the site and sign in again so it picks up the new key. Disconnecting the site
in **Connected Sites** and then signing in again does the same.

#### Privacy Focused

- No data collection or analytics
- Fully open source

### Development

The project has been bootstrapped with Quasar Framework. [Learn More](https://quasar.dev/introduction-to-quasar)

See [DEVELOPING.md](./DEVELOPING.md) for the build and reload loop, the Node version to use, and why
`quasar dev -m bex` does not currently give you a working panel.

#### Icon generation (BEX)

The generated icons are committed (`src-bex/icons/`, `public/icons/`) and referenced by
`src-bex/manifest.json`, so nothing needs to generate them to build or run the extension.

Regenerate only when the source artwork changes:

```bash
nvm use
npx --yes @quasar/icongenie generate -m bex -i public/images/light/diogel.png
```

IconGenie is deliberately not a dependency. It was the root of 25 of 39 audit advisories, including
the only critical one, for a tool last needed in May (threenine/diogel#204).

### Deployment

Detailed instructions for setting up GitHub Secrets and publishing to the Chrome Web Store can be found in [DEPLOYMENT.md](./DEPLOYMENT.md).

### Installation

#### Chrome Web store

- [Diogel - Chrome Web Store](https://chromewebstore.google.com/detail/diogel/inhkmeiabnknligdjngmoocohdonoboa)

#### Firefox Add Ins

- [Diogel - Firefox Add-Ons](https://addons.mozilla.org/en-US/firefox/addon/diogel/)

#### Github Repository 
To install a browser extension from the GitHub repository, follow these steps:

1. Download the extension code
   Go to the e[releases page](https://github.com/threenine/diogel/releases) , select the latest release, and expand the "Assets" section.
   Select "Download ZIP" to get the source files.

2. Extract the ZIP file
   Unzip the downloaded file to a folder on your computer. Make sure the folder contains a manifest.json file, which is required for Chrome extensions.

3. Enable Developer Mode in Chrome
   Open Chrome and go to chrome://extensions. Toggle on "Developer mode" in the top right corner.

4. Load the extension
   Click "Load unpacked", then navigate to the folder where you extracted the files. Select it and click "Open".

The extension will now appear in your extensions list and be active.



