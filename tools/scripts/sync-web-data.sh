#!/usr/bin/env bash
set -euo pipefail

SOURCE="data/raw/act_law_firms.json"
TARGET="apps/web/public/data/act_law_firms.json"

if [[ ! -f "$SOURCE" ]]; then
  echo "Source file not found: $SOURCE"
  echo "Run: npm run data:fetch"
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"
cp "$SOURCE" "$TARGET"

echo "Synced $SOURCE -> $TARGET"
