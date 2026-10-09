#!/usr/bin/env bash
# Install the Feishu tool-summary aggregation patch.
# Discovers the plugin path itself; no host-specific paths.
set -euo pipefail

PATCH_FILE="${1:-$(dirname "$0")/../patches/feishu-tool-aggregation-2026.9.9.patch}"
EXPECTED_ORIG="53bd8ecf58ec2eda5a8fdc32f14ae284bfdf99ed73cb7c20ea2a2c297173d4aa"
EXPECTED_PATCHED="140fad8e7b3764929d15bc6dbde74356adf617aa1d30564ffa8979ac47b3e7d5"

hash_of() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$1" | cut -d' ' -f1; }

TARGET=$(find "$HOME/.openclaw/npm/projects" -path '*@openclaw/feishu/dist/.setup/monitor.account-*.mjs' 2>/dev/null | head -1)
[ -n "$TARGET" ] || { echo "ERROR: no monitor.account-*.mjs found under ~/.openclaw/npm/projects"; exit 1; }
echo "target: $TARGET"

CUR=$(hash_of "$TARGET")
if [ "$CUR" = "$EXPECTED_PATCHED" ]; then
  echo "already patched ($CUR) — nothing to do"; exit 0
fi
if [ "$CUR" != "$EXPECTED_ORIG" ]; then
  echo "ERROR: unexpected original hash"
  echo "  expected: $EXPECTED_ORIG"
  echo "  actual  : $CUR"
  echo "This OpenClaw/plugin version is NOT the one this patch was built for."
  echo "Re-derive the anchors instead of applying blindly. See docs/PORTING.md"; exit 1
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ARCHIVE="$HOME/.openclaw/patches/feishu-tool-aggregation-$STAMP"
mkdir -p "$ARCHIVE"
cp -p "$TARGET" "$ARCHIVE/original.mjs"
echo "backup: $ARCHIVE/original.mjs"

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
cp "$TARGET" "$WORK/f.mjs"
patch --dry-run -p0 "$WORK/f.mjs" < "$PATCH_FILE" >/dev/null || { echo "ERROR: patch dry-run failed"; exit 1; }
patch -p0 "$WORK/f.mjs" < "$PATCH_FILE" >/dev/null
node --check "$WORK/f.mjs" || { echo "ERROR: syntax check failed"; exit 1; }
NEW=$(hash_of "$WORK/f.mjs")
[ "$NEW" = "$EXPECTED_PATCHED" ] || { echo "ERROR: result hash $NEW != $EXPECTED_PATCHED"; exit 1; }

# The expected-hash check proves the patch is the one we built, not that the
# behaviour is right. Confirm the predicate actually shipped is the one the
# contract tests were written against, before touching the live file.
node "$(dirname "$0")/verify-predicate.mjs" "$WORK/f.mjs" \
  || { echo "ERROR: predicate drift — refusing to install"; exit 1; }

cp "$WORK/f.mjs" "$TARGET"
echo "installed. hash=$(hash_of "$TARGET")"
node "$(dirname "$0")/verify-predicate.mjs" "$TARGET" >/dev/null \
  && echo "verified: predicate matches tests/contract.test.mjs"
echo
echo "RESTART REQUIRED. Options:"
echo "  systemd:  systemctl --user restart openclaw-gateway"
echo "  macOS:    launchctl kickstart -k gui/\$(id -u)/ai.openclaw.gateway"
