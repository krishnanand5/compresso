# OpenCode integration

[compresso-cli](https://github.com/krishnanand5/pxpipe) compresses LLM
requests on the wire, converting bulky system prompts, tool definitions, and
old conversation history into dense PNGs — available as a local HTTP proxy for
OpenCode.

## How it works

OpenCode uses the AI SDK with both OpenAI Chat Completions (`/v1/chat/completions`)
and Anthropic Messages (`/v1/messages`) APIs. The compresso proxy intercepts both
request families, compresses them, forwards to the real API, and returns the
compressed response.

```
opencode ──► compresso proxy (127.0.0.1:47821) ──► api.openai.com / api.anthropic.com
```

## Prerequisites

- Node.js >= 18
- API key for at least one provider (`OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`)
- OpenCode installed from https://opencode.ai
- compresso-cli installed (see [installation](#installation))
- A model in the compression scope (see [model scope](#model-scope))

## Installation

compresso-cli is distributed as a `.tgz` file (not published to npm yet).
Your friend who built it can give you the tarball, or you can download it
from wherever they shared it.

```bash
# Install from the .tgz file (use the actual filename from builds/)
npm install -g ./builds/compresso-cli-v0.1.0-2026-07-15-210837.tgz

# Verify
compresso --version
compresso opencode --help
```

`npm` resolves runtime dependencies (`@github/copilot-sdk`, `gpt-tokenizer`,
etc.) from the public registry automatically — no extra steps needed.

> **Tip:** If you're the one distributing it, run `bash scripts/bundle.sh`
> in the project root to produce a dated `.tgz` in `builds/`.

Confirm `opencode` is on your PATH:

```bash
which opencode
```

## Usage

### Quick start (single session)

Run `compresso opencode` — it starts the proxy on port 47821, waits for it to be
ready, writes a temporary `opencode.json` with `baseURL` overrides, then spawns
OpenCode with `OPENCODE_CONFIG` pointing at the temp file.

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
compresso opencode
```

When the OpenCode session ends, compresso cleans up the temp config and shuts
the proxy down automatically. Use `/models` in OpenCode to select a model.

### Single-shot prompt

```bash
compresso opencode "explain the decorator pattern in Python"
```

Runs `opencode run` with the prompt and exits.

### Persistent setup (optional)

If you use OpenCode daily and don't want to remember `compresso opencode`, run
`--setup` once to merge the proxy overrides into `~/.config/opencode/opencode.json`:

```bash
compresso opencode --setup
```

This adds (or merges) the following provider configuration:

```json
{
  "provider": {
    "openai": {
      "options": {
        "baseURL": "http://127.0.0.1:47821/v1"
      }
    },
    "anthropic": {
      "options": {
        "baseURL": "http://127.0.0.1:47821"
      }
    }
  }
}
```

Existing provider settings are preserved — only `baseURL` is overridden.

After setup, start the proxy yourself and run `opencode` directly:

```bash
compresso proxy --port 47821 &         # start proxy in background
opencode                               # uses the compresso proxy
```

### Custom port

```bash
compresso opencode --port 47899
```

### Custom model

```bash
compresso opencode --model gpt-5.6-sol
```

You can also select a model in OpenCode's `/models` picker at any time.

## Model scope

Compression is enabled by default for `claude-fable-5`, the **GPT 5.6
family** (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`),
`deepseek-v4-flash`, and `nemotron-3-ultra` (and its variants like
`nemotron-3-ultra-550b-a55b`). All other models pass through uncompressed.

To enable compression for additional models, set `COMPRESSO_MODELS`:

```bash
# Enable a specific model
COMPRESSO_MODELS=gpt-5.6-sol compresso opencode -m gpt-5.6-sol

# Enable multiple models
COMPRESSO_MODELS=claude-fable-5,gpt-5.6-sol,gpt-5.6-terra compresso opencode

# Disable compression entirely
COMPRESSO_MODELS=off compresso opencode
```

You can also toggle models at runtime via the dashboard at
`http://127.0.0.1:47821/`.

## How model names are matched

OpenCode sends model names prefixed with a provider identifier (e.g.
`openai/gpt-5.6-sol`, `anthropic/claude-fable-5`). The compresso proxy strips
the `provider/` prefix before comparing against the allowlist, so
`openai/gpt-5.6-sol` correctly matches the `gpt-5.6` prefix rule.

## Token savings

Compression applies to:

- **System prompt / instructions** — rendered as a PNG page
- **Tool definitions** — rendered as PNG pages, JSON schema stripped
- **Old conversation history** — turns beyond the recent tail get imaged

The model reads these image blocks via its vision channel. Each image costs a
fixed number of tokens by pixel dimensions, regardless of how much content it
packs. A typical page holds ~3,000 characters at ~1,100 image tokens.

Check savings after a session:

```bash
compresso dashboard
```

The dashboard shows tokens saved per request, compression ratio, and a
per-session breakdown.

## Architecture

OpenCode integration is handled by `src/opencode-cli.ts`. The flow:

1. **CLI entry** (`compresso opencode`) parses flags
2. If no proxy is running on the target port, it spawns `dist/node.js` as a
   child process
3. It polls `/api/stats.json` until the proxy responds 200 (up to 15s)
4. It writes a temporary `opencode.json` with baseURL overrides for both
   `openai` and `anthropic` providers
5. It spawns `opencode` with `OPENCODE_CONFIG` pointing at the temp file
6. On OpenCode exit, the temp config is deleted and the proxy is shut down
   (unless it was already running)

The `--setup` path merges the proxy overrides into
`~/.config/opencode/opencode.json`, preserving any existing provider
configuration.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `OpenCode not found` | OpenCode not installed; install from https://opencode.ai |
| `proxy did not start within 15000ms` | Port conflict or build issue; check `dist/node.js` exists, try a different `--port` |
| OpenCode works but no compression (GPT 5.6) | GPT 5.6 is enabled by default; check `COMPRESSO_MODELS` is not overriding it |
| OpenCode works but no compression (other models) | The model is not in the compression scope; set `COMPRESSO_MODELS` or toggle via dashboard |
| No compression for any model | The proxy is not intercepting; verify provider `baseURL` points at the proxy port |
| Proxy doesn't start | Missing API key; set `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` |

To see what the proxy is doing in real time, check `compresso dashboard` or
visit `http://127.0.0.1:47821/` in a browser.
