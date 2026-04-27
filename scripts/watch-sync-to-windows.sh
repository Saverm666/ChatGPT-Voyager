#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC_SCRIPT="$REPO_DIR/scripts/sync-to-windows.sh"

if ! command -v inotifywait >/dev/null 2>&1; then
  echo "inotifywait is not installed. Install it with: sudo apt-get install inotify-tools" >&2
  exit 1
fi

"$SYNC_SCRIPT"

while inotifywait -r -e modify,create,delete,move \
  --exclude '(^|/)(\.git|tmp)(/|$)|(^|/)\.codex$|:Zone\.Identifier$' \
  "$REPO_DIR"; do
  "$SYNC_SCRIPT"
done
