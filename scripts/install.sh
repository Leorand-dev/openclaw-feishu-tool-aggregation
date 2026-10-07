#!/usr/bin/env bash
# Install the Feishu tool-summary aggregation patch.
# Discovers the plugin path itself; no host-specific paths.
set -euo pipefail

PATCH_FILE="${1:-$(dirname "$0")/../patches/feishu-tool-aggregation-2026.9.8.patch}"
EXPECTED_ORIG="df524437a7bc830be736ea5861599a31823c110e2dbc6dc688e4ce320622f88e"
EXPECTED_PATCHED="315954932e5b4ac5afe4069199a788e37016b3b9dae0caffc13160ce05f3d669"

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

cp "$WORK/f.mjs" "$TARGET"
echo "installed. hash=$(hash_of "$TARGET")"
echo
echo "RESTART REQUIRED. Options:"
echo "  systemd:  systemctl --user restart openclaw-gateway"
echo "  macOS:    launchctl kickstart -k gui/\$(id -u)/ai.openclaw.gateway"
