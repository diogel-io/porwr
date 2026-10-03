# Release Pipeline

Porwr releases are fully automated through GitHub Actions once a release PR is reviewed and
merged. There is no local "release" step any more — the `npm run release` script has been
removed so a developer cannot accidentally run the superseded push-and-tag process.

## How it works

1. Every commit merged to `master` (via a normal, code-owner-reviewed PR, per branch
   protection) is analyzed by [Release Please](https://github.com/googleapis/release-please)
   through `.github/workflows/release.yml`.
2. If the commits since the last release include a qualifying `feat`/`fix`/`perf`/breaking
   change, Release Please opens or updates a single **release PR** titled
   `chore(release): <version>` that:
   - bumps `version` in `package.json` and `package-lock.json`,
   - regenerates `CHANGELOG.md` with the new section.
   - If there are no qualifying commits, no PR is opened and nothing is released.
3. Merging the release PR (a normal, reviewed, code-owner-approved PR against `master`, exactly
   like any other change) is the action that triggers a release. On that merge, the same
   `release.yml` workflow:
   - creates the Git tag and a **draft** GitHub release for the release commit,
   - checks out that exact commit and builds it with the Node version pinned in `.nvmrc`,
   - builds the default Quasar app and the Chrome and Firefox extension bundles,
   - validates that both built `manifest.json` files report the released version,
   - packages deterministic `diogel-chrome-v<version>.zip` / `diogel-firefox-v<version>.zip`
     archives, uploads them as workflow artifacts, attaches both to the draft release, and
     then publishes it,
   - publishes the Chrome archive to the Chrome Web Store and the Firefox archive to Firefox
     Add-ons (AMO) in two independent jobs.
4. A workflow-level `concurrency` group (`porwr-release`) serializes every run of this
   workflow — pushes, manual dispatches, and reruns all queue rather than run in parallel — so
   simultaneous merges or reruns cannot create duplicate tags, releases, or store submissions.

### Immutable releases

The repository has GitHub's immutable releases on: once a release is published, its assets and
tag cannot change. That's why Release Please creates a draft (`"draft": true`) and the build job
publishes it only after the archives are attached. `"force-tag-creation": true` creates the tag
with the draft; without it a draft has no tag, and the next run cannot find the previous release.

A re-run against a release that is already published uploads nothing and says so. Its assets are
fixed. A failed build leaves the draft unpublished: fix the cause and re-run the failed jobs.

To rebuild a release, or publish it to the stores, without touching its GitHub release, run
**Release** by hand with `tag` set to the existing tag (and `publish` on for the stores). The
jobs after `resolve` use `always()` in their conditions because release-please is skipped on a
manual run; without it they were skipped too, and a manual run built nothing.

Ordinary commits to `master` that are not conventional-commit qualifying (e.g. `chore`, `docs`,
`refactor` alone) update or leave the release PR alone; they never trigger a build or a
publish.

## Porwr's pre-1.0.0 version rules

Porwr is pre-`1.0.0`, so Release Please is configured (`release-please-config.json`) with
`bump-minor-pre-major: true` and `bump-patch-for-minor-pre-major: false`:

| Commit type | Effect while `major` is `0` |
| --- | --- |
| `fix:` | Patch bump (`0.0.x` → `0.0.x+1`) |
| `feat:` | Minor bump (`0.x.y` → `0.(x+1).0`) — this is the intended route from `0.0.32` to `0.1.0` the first time a `feat` commit lands |
| `feat!:` / `BREAKING CHANGE:` footer | Minor bump while pre-1.0 (same as `feat`); Release Please never bumps `major` automatically — moving to `1.0.0` is a deliberate, manual `release-as` override |

Release Please was bootstrapped from `0.0.32` (`.release-please-manifest.json`), matching the
`version` already published in `package.json` and tagged as `v0.0.32`. The pre-existing
mismatch where `package-lock.json` still reported `0.0.30` is corrected automatically the first
time Release Please computes a new version: both `package.json` and `package-lock.json` are
rewritten to the same new version number as a mechanical field update, not a dependency
re-resolution, so no dependency actually changes.

## Required secrets

All secrets below already exist on `threenine/diogel` (Settings → Secrets and variables →
Actions). The release workflow does not introduce any new secret names.

| Secret | Used by |
| --- | --- |
| `CWS_EXTENSION_ID`, `CWS_PUBLISHER_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` | `publish-chrome` job — see [Chrome Web Store credentials](#deploying-to-the-chrome-web-store) below |
| `AMO_ADDON_ID`, `AMO_API_ISSUER`, `AMO_API_SECRET` | `publish-firefox` job — see [Firefox Add-ons credentials](#deploying-to-firefox-add-ons-amo) below |
| `GITHUB_TOKEN` (built-in) | Release Please, tag/release creation, attaching archives to the release |

## Reviewing a release PR

- Release Please opens/updates the PR using the default `GITHUB_TOKEN`. Because of GitHub's
  recursion-prevention rule, workflow runs created by the default token do not themselves
  trigger other `pull_request`-triggered workflows — so the required `build` status check on
  the release PR will **not** appear automatically. A maintainer must trigger it once, either
  by closing and reopening the PR or by pushing a trivial commit to its branch; either action
  is a human-initiated event and fires `ci.yml` normally. This is a known GitHub Actions
  limitation, not a bug in this pipeline.
- Branch protection on `master` still applies in full to the release PR: it needs the `build`
  check green, one code-owner approval, and linear history/conversation resolution, exactly
  like any other PR. This is the deliberate "reviewed release-PR checkpoint" — releases never
  fire on an ordinary merge, only on merging this reviewed PR.
- Review the generated `CHANGELOG.md` diff and version bump before approving. If commits were
  miscategorized (e.g. a breaking change without a `!`/footer), fix the source commit message
  and let Release Please regenerate the PR rather than hand-editing the generated PR.

## Publishing

Publishing happens automatically as part of `release.yml` once the release PR is merged — see
"How it works" above. No manual store upload is required for a normal release.

## Exercising a dry run (no store publish)

To validate that the pipeline still builds, versions, and packages correctly without publishing
anything, run the workflow manually:

```bash
gh workflow run release.yml --repo threenine/diogel \
  -f tag=v<version-already-tagged> -f publish=false
```

This runs the `build` job (checkout, install, all three builds, manifest-version validation,
deterministic packaging, artifact upload) but skips both store-publish jobs and does not attach
archives to a GitHub release (`publish` defaults to `false`, and manual dispatches never
re-attach to the release). Use it to sanity-check a tag before trusting a real release run, or
to regenerate archives for inspection.

## Rerunning a failed store job

Chrome and Firefox publish in two independent jobs (`publish-chrome`, `publish-firefox`), so a
failure in one never blocks or duplicates the other. To retry only the failed side:

1. Open the failed `release.yml` run in the Actions tab.
2. Use GitHub's **Re-run failed jobs**. Because `publish-chrome`/`publish-firefox` depend on the
   already-built `build` job's outputs and artifacts, a rerun reuses the same tag, commit,
   version, and archives — it does not create a new tag, release, or version bump.
3. Before retrying, check the store dashboard (Chrome Web Store Developer Dashboard / AMO
   Developer Hub) to confirm that store did not actually receive the previous submission
   despite the workflow reporting failure (e.g. a timeout after the upload succeeded). Retrying
   an upload the store never received is safe; retrying one it already has may be rejected by
   the store as a duplicate version, which is expected and harmless.

## Recovery from partial publication

If one store published successfully and the other failed (e.g. Chrome succeeded, Firefox
failed), the tag, GitHub release, and both archives already exist and do not need to be
recreated:

1. Re-run only the failed publish job as described above — this does not touch the store that
   already succeeded.
2. If the archives themselves need to be regenerated (rare — only if the `build` job's output
   was somehow lost), re-run the whole workflow run's failed jobs from the top; `build` will
   reproduce byte-identical archives from the same tagged commit.
3. Never push a new commit or open a new release PR solely to retry a failed store
   publication — that would create an unwanted new version. The existing tag and release are
   reused as-is.

---

### Deploying to the Chrome Web Store

To automate the publishing of the **diogel** extension to the Chrome Web Store using GitHub Actions, you need to configure several repository secrets.

#### 1. Required GitHub Secrets

Navigate to your repository on GitHub:
**Settings** > **Secrets and variables** > **Actions** > **New repository secret**

Add the following five secrets:

| Secret Name | Description |
| :--- | :--- |
| `CWS_EXTENSION_ID` | The 32-character ID of your extension in the Chrome Web Store. |
| `CWS_PUBLISHER_ID` | Your publisher ID, from the Developer Dashboard's **Publisher > Settings**. The API v2 addresses items as `publishers/<publisher ID>/items/<extension ID>`. |
| `CWS_CLIENT_ID` | OAuth2 Client ID from the Google Cloud Console. |
| `CWS_CLIENT_SECRET` | OAuth2 Client Secret from the Google Cloud Console. |
| `CWS_REFRESH_TOKEN` | OAuth2 Refresh Token used to generate access tokens for the API. |

---

#### 2. How to Obtain the Credentials

##### A. Get the Extension ID (`CWS_EXTENSION_ID`)
1. Log in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. If you haven't already, create a new item and upload a draft version of the extension.
3. Once the item is created, the **Item ID** (32 characters) will be visible in the dashboard or the URL.

##### B. Create Google Cloud Project & API Credentials (`CLIENT_ID` & `CLIENT_SECRET`)
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., "Diogel Extension").
3. Search for and enable the **Chrome Web Store API**.
4. Configure the **OAuth Consent Screen**:
   - Choose **External** (unless you have a Google Workspace org).
   - Fill in required app information.
   - Add the scope: `https://www.googleapis.com/auth/chromewebstore`.
   - **Crucial:** Change the **Publishing Status** from "Testing" to "In production". If it remains in "Testing", your `CWS_REFRESH_TOKEN` will expire every 7 days.
   - Add your own email as a **Test User** (if you keep it in Testing mode, but "In production" is recommended for long-term automation).
5. Go to **Credentials** > **Create Credentials** > **OAuth Client ID**.
   - Select **Desktop App** as the Application Type.
   - Name it "GitHub Actions Publisher".
   - Copy the generated `Client ID` and `Client Secret`.

##### C. Generate the Refresh Token (`CWS_REFRESH_TOKEN`)
The most reliable way is using the **Google OAuth2 Playground**:

1. Go to the [Google OAuth2 Playground](https://developers.google.com/oauthplayground/).
2. Click the **cog icon** (Settings) in the top right corner.
3. Check **"Use your own OAuth credentials"**.
4. Enter your `CWS_CLIENT_ID` and `CWS_CLIENT_SECRET`.
5. In **Step 1 (Select & authorize APIs)**, paste this into the input box: `https://www.googleapis.com/auth/chromewebstore`.
6. Click **Authorize APIs** and log in with your developer account.
7. In **Step 2 (Exchange authorization code for tokens)**, click **Exchange authorization code for tokens**.
8. Copy the `refresh_token` from the JSON response. Save this as your GitHub secret.

Alternatively, you can use a manual authorization flow in your browser:

1. Replace `YOUR_CLIENT_ID` in the following URL and open it in your browser:
   `https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=YOUR_CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob`
2. Log in with the Google account used for the Developer Dashboard.
3. Authorize the app and copy the **Authorization Code** provided.
4. Use `curl` to exchange the code for a refresh token (replace the placeholders):

```bash
curl "https://accounts.google.com/o/oauth2/token" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=YOUR_AUTHORIZATION_CODE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob"
```

5. The response will contain a `refresh_token`. Save this as your GitHub secret.

---

#### 3. How the workflow publishes

The `publish-chrome` job runs `.github/scripts/publish-chrome.sh`, which uses the
[Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/using-api):

1. It gets an access token from the refresh token.
2. It reads the item's status. If this version is already published, or already submitted
   (pending review or staged), it stops there, so a re-run never submits twice.
3. It uploads the archive, waits while the store processes it, and checks the store read the
   released version from it.
4. It submits the item for review. The store publishes it once it passes review.

**Any failure prints the Chrome Web Store's own response**, which says what is wrong. The
earlier action printed only `Response code 400`, which is why every release from 0.1.0 to
0.2.0 had to be submitted by hand without anyone knowing why (workspace#25).
`.github/scripts/test-publish-chrome.sh` tests the script against a stand-in for the API, and
CI runs it.

**If the upload succeeded and the publish didn't,** fix the cause, then run **Release** by hand
with `tag` set to the release, `publish` on, and `chrome_publish_only` on. That submits the
package already uploaded, and skips the Firefox job, since AMO already has that version.

Google's documentation names two causes of a publish that's refused while the upload works:

- The Google account that owns the item must have **2-step verification** turned on.
- **If visibility was changed in the Developer Dashboard**, the API can't publish until a version
  has been published there by hand with the new visibility.

#### 4. Troubleshooting 401 Unauthorized Errors

If the publish step fails with HTTP 401 (Unauthorized), or the token request is refused, check the following:

1.  **Refresh Token Expired**: If your Google Cloud project is in "Testing" mode, the refresh token expires every 7 days. Set it to **"In production"** on the OAuth Consent Screen.
2.  **Incorrect Scopes**: Ensure the token was generated with the `https://www.googleapis.com/auth/chromewebstore` scope.
3.  **Client Secret Mismatch**: If you regenerated your Client Secret in Google Cloud Console, you must update `CWS_CLIENT_SECRET` in GitHub Secrets.
4.  **Extension Ownership**: The Google account used to generate the `CWS_REFRESH_TOKEN` must have developer access to the extension identified by `CWS_EXTENSION_ID`.
5.  **API Not Enabled**: Ensure the **Chrome Web Store API** is enabled in your Google Cloud project.

---

### Deploying to Firefox Add-ons (AMO)

To automate the publishing of the **diogel** extension to the Firefox Add-on Hub (AMO) using GitHub Actions, you need to configure three additional repository secrets.

#### 1. Required GitHub Secrets

Navigate to your repository on GitHub:
**Settings** > **Secrets and variables** > **Actions** > **New repository secret**

Add the following three secrets:

| Secret Name | Description |
| :--- | :--- |
| `AMO_ADDON_ID` | The unique ID of your add-on (usually a UUID or an email-like ID). |
| `AMO_API_ISSUER` | Your JWT issuer key from the AMO credentials page. |
| `AMO_API_SECRET` | Your JWT secret key from the AMO credentials page. |

---

#### 2. How to Obtain the Credentials

##### A. Get the Add-on ID (`AMO_ADDON_ID`)
1. Log in to the [Firefox Add-on Developer Hub](https://addons.mozilla.org/en-US/developers/).
2. Submit your extension as a new add-on (or use an existing one).
3. Once submitted, navigate to the **Edit Product Page**.
4. The **Add-on ID** can be found under the "Technical Details" section (e.g., `{1234abcd-1234-abcd-1234-abcd1234abcd}` or `diogel@your-domain.com`).

##### B. Create API Credentials (`AMO_API_ISSUER` & `AMO_API_SECRET`)
1. Go to the [API Credentials Page](https://addons.mozilla.org/en-US/developers/addon/api/key/) in the Developer Hub.
2. Read and accept the agreement if prompted.
3. Your **JWT Issuer** and **JWT Secret** will be displayed.
4. Copy these into your GitHub repository secrets.

---

#### 3. Automatic Publishing
Once these secrets are set, the `publish-firefox` job in `.github/workflows/release.yml` will
automatically:
- Run when a Release Please release PR is merged to `master` (see [Release Pipeline](#release-pipeline) above) — not on an arbitrary Git tag push.
- Use the Firefox archive already built and validated by the `build` job.
- Upload the extension to Firefox Add-ons (AMO) for signing and publication.
- Reuse the GitHub Release and tag that the same workflow run already created; it does not create its own tag or release.

---

#### 4. Troubleshooting 400 Bad Request (release_notes)

If the GitHub Action fails with `400 Bad Request {"release_notes":["This field may not be blank."]}`, it means the `release-note` field is required by the AMO API but was either missing or empty in the workflow.

The `publish-firefox` job in `.github/workflows/release.yml` includes a default `release-note`
based on the release tag name. If you wish to provide more detailed notes, modify the
`release-note` parameter on the `Publish to AMO (Firefox Add-ons)` step in that job.
