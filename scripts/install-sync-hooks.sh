#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_DIR="$REPO_DIR/.git/hooks"
SYNC_SCRIPT="$REPO_DIR/scripts/sync-to-windows.sh"

if [[ ! -d "$HOOK_DIR" ]]; then
  echo "Cannot find .git/hooks. Run this script from inside the Git repo." >&2
  exit 1
fi

install_hook() {
  local hook_name="$1"
  local hook_path="$HOOK_DIR/$hook_name"

  cat > "$hook_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail

"$SYNC_SCRIPT" >/tmp/chatgpt-voyager-sync.log 2>&1 || {
  status=\$?
  echo "ChatGPT-Voyager sync failed. See /tmp/chatgpt-voyager-sync.log" >&2
  exit \$status
}
EOF

  chmod +x "$hook_path"
  echo "Installed $hook_name"
}

install_hook post-commit
install_hook post-checkout
install_hook post-merge
install_hook post-rewrite

echo "Sync hooks installed."
