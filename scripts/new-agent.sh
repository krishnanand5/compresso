#!/usr/bin/env bash
# Usage: bash scripts/new-agent.sh <agent-id> <binary-name> <default-port>
# Example: bash scripts/new-agent.sh cursor cursor 47824
set -euo pipefail

id=$1
binary=$2
port=$3
src="src/agents/_template"
dst="src/agents/$id"

if [ -d "$dst" ]; then
  echo "error: $dst already exists"
  exit 1
fi

cp -r "$src" "$dst"

echo "✓ scaffolded $dst from template — now edit all 4 files:"
echo "  1. $dst/index.ts   (agent id, displayName, binaryName, defaultPort, supportedModels, envVars, helpText)"
echo "  2. $dst/cli.ts     (imports, writeConfig call)"
echo "  3. $dst/config.ts  (config file format and location)"
echo "  4. $dst/child.ts   (spawn args, binary path)"
echo ""
echo "Then create the CLI shim src/${id}-cli.ts:"
echo "  import { main } from './agents/${id}/cli.js';"
echo "  main().catch((err) => { ... });"
echo ""
echo "Then register in:"
echo "  - scripts/build.mjs (add entry: { in: 'src/${id}-cli.ts', out: 'dist/${id}-cli.js' })"
echo "  - src/cli/dispatch.ts (add entry: { name: '${id}', entry: 'dist/${id}-cli.js' })"
echo ""
echo "See ADD_NEW_AGENT.md for the full procedure."
