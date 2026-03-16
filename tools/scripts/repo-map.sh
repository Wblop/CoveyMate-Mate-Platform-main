#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

echo "ConveyMate repository map (max depth: 3)"
echo "Generated/runtime folders are hidden."
echo

find . -maxdepth 3 -type d \
  | rg -v '/(\.git|node_modules|dist|\.angular|bin|obj|TestResults|\.venv|\.logs|__pycache__|_debug)(/|$)' \
  | sed 's|^\./||' \
  | awk 'NF > 0 { print $0 }' \
  | sort
