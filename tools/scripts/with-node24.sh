#!/usr/bin/env bash
set -euo pipefail

if [[ -d "/opt/homebrew/opt/node@24/bin" ]]; then
  export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
elif [[ -d "/usr/local/opt/node@24/bin" ]]; then
  export PATH="/usr/local/opt/node@24/bin:$PATH"
fi

exec "$@"
