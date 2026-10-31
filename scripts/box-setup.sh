#!/usr/bin/env bash
# Prepares a Boat machine for `box`, which runs it whenever it changes: the Bun that package.json
# pins, since the stock image's older one can't read bun.lock.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

version="$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' package.json)"
if [[ "$(bun --version 2>/dev/null)" != "$version" ]]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v$version"
  sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
  sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bunx
fi
