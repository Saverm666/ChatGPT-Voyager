#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${CHATGPT_VOYAGER_WINDOWS_DIR:-/mnt/c/BaiduNetdiskDownload/Tool/ChatGPT-Voyager}"

case "$TARGET_DIR" in
  ""|"/"|"/mnt"|"/mnt/c"|"/mnt/c/"*)
    if [[ "$TARGET_DIR" != */ChatGPT-Voyager ]]; then
      echo "Refusing to sync to unsafe target: $TARGET_DIR" >&2
      exit 1
    fi
    ;;
esac

mkdir -p "$TARGET_DIR"

rsync -a --delete --delete-excluded --no-perms --no-owner --no-group \
  --exclude '.git/' \
  --exclude '.codex' \
  --exclude 'tmp/' \
  --exclude '*.zip' \
  --exclude '*.tgz' \
  --exclude '*:Zone.Identifier' \
  "$SOURCE_DIR/" \
  "$TARGET_DIR/"

echo "Synced ChatGPT-Voyager to $TARGET_DIR"
