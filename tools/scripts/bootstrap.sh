#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required."
  exit 1
fi

NODE_VERSION="$(node -p "process.versions.node")"
NODE_MAJOR="$(echo "$NODE_VERSION" | cut -d. -f1)"

if [[ "$NODE_MAJOR" -lt 24 ]]; then
  echo "Node.js 24+ is required. Current: $NODE_VERSION"
  echo "Install Node LTS 24.13.1 and ensure it is first in PATH."
  exit 1
fi

(
  cd apps/web
  npm install
)

echo "Bootstrap complete."
