# Adding a New Coding Agent to pxpipe

This document describes the requirements and procedure for integrating a new
coding agent (Cursor, Aider, Continue, Cline, Windsurf, CodeGPT, etc.) into
the pxpipe proxy.

## Overview

A new agent requires:

- **4 files** in `src/agents/<id>/` (index.ts, cli.ts, config.ts, child.ts)
- **2 registrations** (build pipeline + CLI dispatch)
- **1 CLI shim** (`src/<id>-cli.ts`)
- **1 test** (auto-validated by the integration test)
- **Multimodal model validation** (pxpipe only works with multimodal models)

Total: a human can do it in ~30 minutes with the template scaffold.

## Agent Families

### BaseUrlAgent (env vars + spawn child)

For agents that accept `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` environment
variables. The proxy runs as a child process and sets these vars to redirect
the agent's API calls.

**Examples:** Codex CLI (`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`),
OpenCode (`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`)

### SdkAgent (in-process handler)

For agents that provide an SDK that can intercept requests in-process.
The proxy logic runs inside the agent's process rather than as a separate
child.

**Examples:** Copilot SDK (`@github/copilot-sdk`)

### Decision

Use BaseUrlAgent when the agent is a standalone CLI tool that accepts base URL
env vars. Use SdkAgent when the agent provides a programmatic SDK interface.

## Requirements

### Every agent must provide:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier (lowercase, no spaces) |
| `displayName` | `string` | Yes | Human-readable name |
| `family` | `'base-url' | 'sdk'` | Yes | Agent family |
| `binaryName` | `string` | Only base-url | CLI binary name |
| `defaultPort` | `number` | Yes | Default proxy port (must be unique) |
| `supportedModels` | `string[]` | Yes | Model prefixes the agent supports (must include at least one multimodal model) |
| `envVars()` | `(port) => AgentEnv` | Only base-url | Env vars for redirecting API calls |
| `makeHandler()` | `(opts) => unknown` | Only sdk | SDK handler factory |
| `writeConfig()` | `(opts) => Promise<void>` | Only base-url | Config file writer for `--setup` |
| `helpText` | `string` | Yes | Help text shown by `--help` |

### Every agent must pass the multimodal model check:

pxpipe compresses content into images. The agent **must** support at least one
model from `IMAGE_CAPABLE_BASES` in `src/core/applicability.ts`:

| Model | Provider | Multimodal |
|-------|----------|------------|
| `claude-5` | Anthropic | Yes |
| `claude-fable-5` | Anthropic | Yes |
| `gpt-5.6` | OpenAI | Yes |
| `big-pickle` | Anthropic/OpenAI | Yes |

The integration test (`tests/agent-integration.test.ts`) will fail if your
agent has no multimodal models in `supportedModels`.

## Procedure

### Step 1: Gather agent documentation

Before writing any code, collect these links:

- **Base URL env var support** — Link to docs showing the agent accepts
  `ANTHROPIC_BASE_URL` and/or `OPENAI_BASE_URL` (for base-url agents).
  Without this, the proxy integration cannot work.
- **Supported model list** — Link to the agent's model documentation.
  Must include at least one multimodal model.
- **Config file location** — Link to docs showing the config file path
  and format (TOML, JSON, YAML, etc.).
- **CLI interface** — Link to docs showing CLI binary name and argv flags.

### Step 2: Create the shim

```bash
bash scripts/new-agent.sh <agent-id> <binary-name> <default-port>
```

This scaffolds `src/agents/<id>/` from the template.

Create the CLI entry shim `src/<id>-cli.ts`:

```typescript
#!/usr/bin/env node
export { main } from './agents/<id>/cli.js';
main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
```

### Step 3: Implement the agent

**`src/agents/<id>/index.ts`** — Agent definition:

```typescript
import type { BaseUrlAgent } from '../types.js';
import { registerAgent } from '../registry.js';
import { writeXxxConfig } from './config.js';

export const xxxAgent: BaseUrlAgent = {
  id: '<agent-id>',
  displayName: 'Agent Name',
  family: 'base-url',
  binaryName: '<binary>',
  defaultPort: <port>,
  supportedModels: ['claude-5', 'gpt-5.6'],
  envVars: (port) => ({
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
  }),
  writeConfig: writeXxxConfig,
  helpText: `compresso <agent-id> — compressed Agent session
    compresso <agent-id> "write a test"         single-shot, print, exit
    compresso <agent-id> --port <port>           reuse existing proxy
    compresso <agent-id> --setup                 write config`,
};

registerAgent(xxxAgent);
```

**`src/agents/<id>/config.ts`** — Write the agent's config file. This is the
most agent-specific file. Each agent has its own format and location:

- Codex: `~/.codex/config.toml` (TOML)
- OpenCode: `~/.config/opencode/opencode.json` (JSON)
- Cursor: `~/.cursor/config.json` (JSON)
- Aider: `~/.aider.conf.yml` (YAML)
- Continue: `~/.continue/config.json` (JSON)

**`src/agents/<id>/cli.ts`** and **`src/agents/<id>/child.ts`** — Use the
template files as-is for base-url agents. They import `startProxyIfNeeded`,
`spawnChild`, `buildChildEnv`, and `forwardSignals` from the shared utilities
in `src/agents/shared/`.

### Step 4: Register

**`src/cli/dispatch.ts`** — Add to the `ENTRIES` array:

```typescript
{ name: '<agent-id>', entry: 'dist/<agent-id>-cli.js' },
```

**`scripts/build.mjs`** — Add to the `ENTRIES` array:

```javascript
{ in: 'src/<agent-id>-cli.ts', out: 'dist/<agent-id>-cli.js', external: [] },
```

### Step 5: Register dashboard stats (optional)

In `src/dashboard/index.ts`, register a stats provider so the dashboard can
show per-agent telemetry:

```typescript
registerStatsProvider('<agent-id>', async (opts) => {
  // Parse agent-specific telemetry file, return AgentStats
  return { id: '<agent-id>', displayName: 'Agent Name', ... };
});
```

### Step 6: Verify

```bash
pnpm test                    # All tests must pass
pnpm run build               # Clean build
node dist/<agent-id>-cli.js --help  # Prints help text
node dist/<agent-id>-cli.js --setup  # Writes config file
```

## Verification Checklist

- [ ] `src/agents/<id>/index.ts` — agent definition with all required fields
- [ ] `src/agents/<id>/cli.ts` — CLI entrypoint
- [ ] `src/agents/<id>/config.ts` — config writer for `--setup`
- [ ] `src/agents/<id>/child.ts` — child process spawn
- [ ] `src/<id>-cli.ts` — shim importing cli.ts
- [ ] `src/cli/dispatch.ts` — added to ENTRIES
- [ ] `scripts/build.mjs` — added to ENTRIES
- [ ] `supportedModels` includes at least one multimodal model
- [ ] `helpText` is defined and informative
- [ ] `writeConfig` is defined for base-url agents
- [ ] `defaultPort` doesn't conflict with other agents
- [ ] `pnpm test` passes (integration test auto-checks all of the above)
- [ ] `pnpm run build` succeeds
- [ ] `node dist/<agent-id>-cli.js --help` works
