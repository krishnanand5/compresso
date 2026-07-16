#!/usr/bin/env bash
# Build and package compresso-cli into a .tgz for sharing.
#
# Usage:
#   pnpm run bundle
#   DESKTOP=1 pnpm run bundle       # also copy to ~/Desktop
#
# Output: compresso-cli-<version>.tgz in project root (and optionally Desktop).

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
TARBALL="compresso-cli-v${VERSION}.tgz"

echo "[bundle] building…"
pnpm run build

echo "[bundle] packing…"
pnpm pack --pack-destination "$PWD" 2>&1 | grep -v '^$' || true

# pnpm pack outputs "compresso-cli-<version>.tgz"; rename to include 'v'
if [ -f "compresso-cli-${VERSION}.tgz" ]; then
  mv "compresso-cli-${VERSION}.tgz" "$TARBALL"
fi

SIZE=$(du -h "$TARBALL" | cut -f1)
echo "[bundle] created $TARBALL ($SIZE)"

if [ "${DESKTOP:-0}" = "1" ]; then
  cp "$TARBALL" "$HOME/Desktop/$TARBALL"
  echo "[bundle] also copied to ~/Desktop/$TARBALL"
fi
