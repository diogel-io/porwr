#!/usr/bin/env bash
#
# Tests publish-chrome.sh against a stand-in for curl, so nothing reaches Google
# (diogel-io/workspace#25). Run: bash .github/scripts/test-publish-chrome.sh

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/publish-chrome.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The stand-in: answers by URL from canned files in $FAKE_DIR, and records each call.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<'EOF'
#!/usr/bin/env bash
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output) out="$2"; shift 2 ;;
    --write-out|--header|--request|--upload-file|--data|--data-urlencode) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  *oauth2*) key=token ;;
  *:fetchStatus) key=status ;;
  *upload/v2*:upload) key=upload ;;
  *:publish) key=publish ;;
  *) key=unknown ;;
esac
echo "$key" >> "$FAKE_DIR/calls"
# A key may answer differently on later calls (status.2, status.3, ...).
n=$(grep -cx "$key" "$FAKE_DIR/calls")
file="$FAKE_DIR/$key.$n"; [ -f "$file" ] || file="$FAKE_DIR/$key"
code="$(head -n1 "$file")"
tail -n +2 "$file" > "$out"
printf '%s' "$code"
EOF
chmod +x "$WORK/bin/curl"

passed=0
failed=0

# answer KEY CODE BODY: what the fake API says for KEY.
answer() { printf '%s\n%s\n' "$2" "$3" > "$FAKE_DIR/$1"; }

setup() {
  export FAKE_DIR="$WORK/case-$1"
  mkdir -p "$FAKE_DIR"
  : > "$FAKE_DIR/calls"
  answer token 200 '{"access_token":"ya29.secret-token"}'
  answer status 200 '{"publishedItemRevisionStatus":{"state":"PUBLISHED","distributionChannels":[{"crxVersion":"0.1.1"}]}}'
  answer upload 200 '{"uploadState":"SUCCEEDED","crxVersion":"0.2.0"}'
  answer publish 200 '{"state":"PENDING_REVIEW"}'
  echo zip > "$FAKE_DIR/pkg.zip"
}

run() {
  PATH="$WORK/bin:$PATH" CWS_CLIENT_ID=c CWS_CLIENT_SECRET=s CWS_REFRESH_TOKEN=r \
    CWS_PUBLISHER_ID=p CWS_EXTENSION_ID=e VERSION=0.2.0 ZIP="$FAKE_DIR/pkg.zip" POLL_SECONDS=0 \
    "$@" bash "$SCRIPT" > "$FAKE_DIR/output" 2>&1
  echo $? > "$FAKE_DIR/exit"
}

check() {
  local name="$1" expected_exit="$2" expected_calls="$3" expected_text="$4"
  local exit_code calls
  exit_code="$(cat "$FAKE_DIR/exit")"
  calls="$(paste -sd, "$FAKE_DIR/calls")"
  if [ "$exit_code" = "$expected_exit" ] && [ "$calls" = "$expected_calls" ] \
    && grep -qF -- "$expected_text" "$FAKE_DIR/output" \
    && ! grep -qF 'ya29.secret-token' <(grep -v '::add-mask::' "$FAKE_DIR/output"); then
    passed=$((passed + 1)); echo "ok   $name"
  else
    failed=$((failed + 1)); echo "FAIL $name (exit $exit_code, calls $calls)"; sed 's/^/     /' "$FAKE_DIR/output"
  fi
}

setup uploads-then-submits
run env
check "uploads, then submits for review" 0 "token,status,upload,publish" "submitted, state PENDING_REVIEW"

setup publish-error
answer publish 400 '{"error":{"code":400,"message":"Publish condition not met: example reason"}}'
run env
check "prints Google's reason when publishing is refused" 1 "token,status,upload,publish" "Publish condition not met: example reason"

setup upload-error
answer upload 400 '{"error":{"message":"The version must be greater than the uploaded one"}}'
run env
check "prints Google's reason when the upload is refused, and does not publish" 1 "token,status,upload" "must be greater"

setup waits-for-upload
answer upload 200 '{"uploadState":"IN_PROGRESS"}'
answer status.2 200 '{"lastAsyncUploadState":"IN_PROGRESS"}'
answer status.3 200 '{"lastAsyncUploadState":"SUCCEEDED"}'
run env
check "waits out an upload in progress before publishing" 0 "token,status,upload,status,status,publish" "PENDING_REVIEW"

setup upload-fails-later
answer upload 200 '{"uploadState":"IN_PROGRESS"}'
answer status.2 200 '{"lastAsyncUploadState":"FAILED"}'
run env
check "does not publish an upload that failed while processing" 1 "token,status,upload,status" "state FAILED"

setup already-published
answer status 200 '{"publishedItemRevisionStatus":{"state":"PUBLISHED","distributionChannels":[{"crxVersion":"0.2.0"}]}}'
run env
check "does nothing for a version already published" 0 "token,status" "already published"

setup already-submitted
answer status 200 '{"submittedItemRevisionStatus":{"state":"PENDING_REVIEW","distributionChannels":[{"crxVersion":"0.2.0"}]}}'
run env
check "does nothing for a version already under review" 0 "token,status" "already submitted"

setup publish-only
run env PUBLISH_ONLY=true ZIP=
check "PUBLISH_ONLY submits without uploading" 0 "token,status,publish" "Skipping the upload"

setup wrong-version
answer upload 200 '{"uploadState":"SUCCEEDED","crxVersion":"0.1.9"}'
run env
check "refuses a package whose version is not the release's" 1 "token,status,upload" "not 0.2.0"

setup bad-token
answer token 400 '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}'
run env
check "says why the token was refused" 1 "token" "Token has been expired or revoked."

setup missing-publisher
run env CWS_PUBLISHER_ID=
check "names a missing secret before calling anything" 1 "" "CWS_PUBLISHER_ID is not set"

echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
