#!/usr/bin/env bash
# Build and package compresso-cli into a .tgz for sharing.
#
# Usage:
#   pnpm run bundle
#   DESKTOP=1 pnpm run bundle       # also copy to ~/Desktop
#   NO_BUILD=1 pnpm run bundle      # skip build, repack existing dist
#
# Output:
#   builds/compresso-cli-<version>-<timestamp>.tgz

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
TIMESTAMP=$(date '+%Y-%m-%d-%H%M%S')
BUILDS_DIR="builds"

mkdir -p "$BUILDS_DIR"

if [ "${NO_BUILD:-0}" != "1" ]; then
  echo "[bundle] building…"
  pnpm run build
else
  echo "[bundle] skipping build (NO_BUILD=1)"
fi

echo "[bundle] packing…"
pnpm pack --pack-destination "$BUILDS_DIR" 2>&1 | grep -v '^$' || true

# pnpm pack outputs "compresso-cli-<version>.tgz"; rename with timestamp
RAW="compresso-cli-${VERSION}.tgz"
NAMED="compresso-cli-v${VERSION}-${TIMESTAMP}.tgz"
if [ -f "$BUILDS_DIR/$RAW" ]; then
  mv "$BUILDS_DIR/$RAW" "$BUILDS_DIR/$NAMED"
fi

SIZE=$(du -h "$BUILDS_DIR/$NAMED" | cut -f1)
echo "[bundle] created $BUILDS_DIR/$NAMED ($SIZE)"

if [ "${DESKTOP:-0}" = "1" ]; then
  cp "$BUILDS_DIR/$NAMED" "$HOME/Desktop/$NAMED"
  echo "[bundle] also copied to ~/Desktop/$NAMED"
fi
