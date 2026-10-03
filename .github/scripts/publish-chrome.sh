#!/usr/bin/env bash
#
# Uploads a Porwr package to the Chrome Web Store and submits it for review, through the
# Chrome Web Store API v2 (diogel-io/workspace#25).
#
# It replaces mnao305/chrome-extension-upload, which used the deprecated v1.1 API and printed
# only "Response code 400" when publishing failed, so every release since 0.1.0 had to be
# submitted by hand without anyone being told why. Every failure here prints Google's own
# response body, which names the reason.
#
# Required environment:
#   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN   OAuth credentials (DEPLOYMENT.md)
#   CWS_PUBLISHER_ID                                      Developer Dashboard > Publisher > Settings
#   CWS_EXTENSION_ID                                      The item's 32-character ID
#   VERSION                                               The version being released, e.g. 0.2.0
# Optional:
#   ZIP                  The package to upload. Required unless PUBLISH_ONLY is true.
#   PUBLISH_ONLY=true    Skip the upload and submit the package already uploaded, for when an
#                        upload succeeded and the publish did not.
#   CWS_API, CWS_UPLOAD_API, CWS_TOKEN_URL, POLL_SECONDS   Overridable for tests.

set -euo pipefail

CWS_API="${CWS_API:-https://chromewebstore.googleapis.com/v2}"
CWS_UPLOAD_API="${CWS_UPLOAD_API:-https://chromewebstore.googleapis.com/upload/v2}"
CWS_TOKEN_URL="${CWS_TOKEN_URL:-https://oauth2.googleapis.com/token}"
POLL_SECONDS="${POLL_SECONDS:-10}"
PUBLISH_ONLY="${PUBLISH_ONLY:-false}"

for name in CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN CWS_PUBLISHER_ID CWS_EXTENSION_ID VERSION; do
  # Secrets pasted into GitHub often carry a trailing newline or spaces. The action this replaced
  # trimmed its inputs, so the existing secrets were never checked; untrimmed, an ID in the URL
  # made curl refuse it as malformed before anything reached the store (workspace#25).
  value="${!name:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf -v "$name" '%s' "$value"
  if [ -z "$value" ]; then
    echo "::error::$name is not set. See DEPLOYMENT.md, Deploying to the Chrome Web Store."
    exit 1
  fi
done

# The two IDs go into the URL, so anything but letters, digits, '-' and '_' is a pasting mistake.
# Named, never printed: they are secrets.
for name in CWS_PUBLISHER_ID CWS_EXTENSION_ID; do
  if [[ ! "${!name}" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "::error::$name contains characters an ID cannot (such as a space or a line break inside it). Set the secret again with only the ID."
    exit 1
  fi
done

if [ "$PUBLISH_ONLY" != "true" ] && [ ! -f "${ZIP:-}" ]; then
  echo "::error::No package to upload: ZIP='${ZIP:-}'"
  exit 1
fi

ITEM="publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}"
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT

# Runs curl, leaving the response body in $BODY and printing the HTTP status.
request() {
  curl --silent --show-error --output "$BODY" --write-out '%{http_code}' "$@"
}

# Fails the step with Google's response body, which says what is wrong.
fail_with_body() {
  local what="$1" status="$2"
  echo "::error::$what failed with HTTP $status. The Chrome Web Store said:"
  cat "$BODY"
  echo
  exit 1
}

echo "Getting an access token"
status="$(request "$CWS_TOKEN_URL" \
  --data-urlencode "client_id=$CWS_CLIENT_ID" \
  --data-urlencode "client_secret=$CWS_CLIENT_SECRET" \
  --data-urlencode "refresh_token=$CWS_REFRESH_TOKEN" \
  --data-urlencode "grant_type=refresh_token")"
# The token response is printed only on failure, and then it holds no token.
[ "$status" = "200" ] || fail_with_body "Getting an access token" "$status"
TOKEN="$(jq -r '.access_token // empty' "$BODY")"
[ -n "$TOKEN" ] || fail_with_body "Getting an access token" "$status"
echo "::add-mask::$TOKEN"
AUTH=(--header "Authorization: Bearer $TOKEN")

fetch_status() {
  local code
  code="$(request "${AUTH[@]}" "$CWS_API/$ITEM:fetchStatus")"
  [ "$code" = "200" ] || fail_with_body "Reading the item's status" "$code"
}

# The versions a revision status carries, one per line.
versions_in() {
  jq -r --arg key "$1" '.[$key].distributionChannels[]?.crxVersion // empty' "$BODY"
}

echo "Reading the item's status"
fetch_status
jq '{publishedItemRevisionStatus, submittedItemRevisionStatus, lastAsyncUploadState, takenDown, warned}' "$BODY"

# A re-run must not upload or submit a version that is already through, or on its way.
if versions_in publishedItemRevisionStatus | grep -qxF "$VERSION"; then
  echo "::notice::Version $VERSION is already published in the Chrome Web Store. Nothing to do."
  exit 0
fi
submitted_state="$(jq -r '.submittedItemRevisionStatus.state // empty' "$BODY")"
if versions_in submittedItemRevisionStatus | grep -qxF "$VERSION"; then
  case "$submitted_state" in
    PENDING_REVIEW | STAGED)
      echo "::notice::Version $VERSION is already submitted ($submitted_state). Nothing to do."
      exit 0
      ;;
  esac
fi

if [ "$PUBLISH_ONLY" = "true" ]; then
  echo "Skipping the upload (PUBLISH_ONLY): submitting the package already uploaded"
else
  echo "Uploading $ZIP"
  status="$(request "${AUTH[@]}" --request POST --upload-file "$ZIP" "$CWS_UPLOAD_API/$ITEM:upload")"
  [ "$status" = "200" ] || fail_with_body "Uploading the package" "$status"
  cat "$BODY"
  echo

  upload_state="$(jq -r '.uploadState // empty' "$BODY")"
  # A large package is processed asynchronously; wait for it rather than publish too early.
  for _ in $(seq 1 18); do
    [ "$upload_state" = "IN_PROGRESS" ] || break
    sleep "$POLL_SECONDS"
    fetch_status
    upload_state="$(jq -r '.lastAsyncUploadState // empty' "$BODY")"
    echo "Upload state: $upload_state"
  done

  if [ "$upload_state" != "SUCCEEDED" ]; then
    fail_with_body "Uploading the package (state ${upload_state:-unknown})" "$status"
  fi

  uploaded_version="$(jq -r '.crxVersion // empty' "$BODY")"
  if [ -n "$uploaded_version" ] && [ "$uploaded_version" != "$VERSION" ]; then
    echo "::error::The store read version $uploaded_version from the package, not $VERSION."
    exit 1
  fi
fi

echo "Submitting version $VERSION for review"
status="$(request "${AUTH[@]}" --request POST --header 'Content-Type: application/json' \
  --data '{}' "$CWS_API/$ITEM:publish")"
[ "$status" = "200" ] || fail_with_body "Publishing" "$status"
cat "$BODY"
echo

state="$(jq -r '.state // empty' "$BODY")"
case "$state" in
  PENDING_REVIEW | STAGED | PUBLISHED)
    echo "::notice::Chrome Web Store: version $VERSION submitted, state $state."
    ;;
  *)
    fail_with_body "Publishing (state ${state:-unknown})" "$status"
    ;;
esac
