# Codex CLI integration

[compresso-cli](https://github.com/krishnanand5/pxpipe) compresses OpenAI
Responses API requests on the wire, converting bulky system prompts, tool
definitions, and old conversation history into dense PNGs — the same engine
used by the Copilot SDK bridge, available as a local HTTP proxy for Codex CLI.

## How it works

Codex CLI supports `OPENAI_BASE_URL`, so it can send requests to a local
compresso proxy instead of OpenAI directly. The proxy compresses the request,
forwards it to the real OpenAI Responses API, and returns the compressed
response to Codex. Codex never knows the difference.

```
codex ──► compresso proxy (127.0.0.1:47821) ──► api.openai.com
```

## Prerequisites

- Node.js >= 18
- OpenAI API key (`OPENAI_API_KEY`)
- Codex CLI installed globally: `npm install -g @openai/codex`
- compresseo-cli installed (see [installation](#installation))

## Installation

compresso-cli is distributed as a `.tgz` file (not published to npm yet).
Your friend who built it can give you the tarball, or you can download it
from wherever they shared it.

```bash
# Install from the .tgz file
npm install -g ./compresso-cli-v0.1.0.tgz

# Verify
compresso --version
compresso codex --help
```

`npm` resolves the runtime dependencies (`@github/copilot-sdk`,
`gpt-tokenizer`, etc.) from the public registry automatically — no
extra steps needed.

> **Tip:** If you're the one distributing it, run `pnpm run build && pnpm pack`
> in the project root to produce `compresso-cli-v0.1.0.tgz`.

Confirm `codex` is on your PATH:

```bash
which codex
```

## Usage

### Quick start (single session)

Run `compresso codex` — it starts the proxy on port 47821, waits for it to be
ready, then spawns Codex CLI with `OPENAI_BASE_URL` pointing at the proxy.

```bash
export OPENAI_API_KEY="sk-..."
compresso codex
```

When the Codex session ends, compresso shuts the proxy down automatically.

### Single-shot prompt

```bash
compresso codex "write a python script to sort a CSV by column 3"
```

Prints the response to stdout and exits.

### Persistent setup (optional)

If you use Codex daily and don't want to remember `compresso codex`, run
`--setup` once to write a Codex model provider config:

```bash
compresso codex --setup
```

This writes `~/.codex/config.toml` with:

```toml
[model_providers.compresso]
name = "Compresso"
base_url = "http://127.0.0.1:47821"
env_key = "CODEX_PROXY_KEY"
wire_api = "responses"

[profiles.default]
model = "gpt-4o"
model_provider = "compresso"
```

And appends `export CODEX_PROXY_KEY="<your-api-key>"` to `~/.zshrc`.

After setup, start the proxy yourself and run `codex` directly:

```bash
compresso proxy --port 47821 &         # start proxy in background
codex                                   # uses the compresso provider
```

### Custom port

If port 47821 is in use:

```bash
compresso codex --port 47899
```

### Custom model

```bash
compresso codex --model gpt-4.1
```

Or override the API key per-run:

```bash
compresso codex -k sk-...
```

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

Codex CLI integration is handled by `src/codex-cli.ts`. The flow:

1. **CLI entry** (`compresso codex`) parses flags and resolves the API key
2. If no proxy is running on the target port, it spawns `dist/node.js` as a
   child process (the same proxy that serves Claude Code and general OpenAI
   traffic)
3. It polls `/api/stats.json` until the proxy responds 200 (up to 15s)
4. It spawns `codex` with `OPENAI_BASE_URL` overridden to
   `http://127.0.0.1:<port>`
5. On Codex exit, the proxy is shut down (unless it was already running)

The `--setup` path writes a persistent Codex provider config so the proxy and
Codex can be started independently. The provider uses `wire_api = "responses"`
matching the OpenAI Responses API format that compresso's
`transformOpenAIResponses()` compressor expects.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `No API key found` | `OPENAI_API_KEY` not set; pass `--api-key` or set the env var |
| `Codex CLI not found` | `@openai/codex` not installed globally; run `npm install -g @openai/codex` |
| `proxy did not start within 15000ms` | Port conflict or build issue; check `dist/node.js` exists, try a different `--port` |
| Codex works but no compression | The proxy is not intercepting; verify `OPENAI_BASE_URL` is set to the proxy port |

To see what the proxy is doing in real time, check `compresso dashboard` or
visit `http://127.0.0.1:47821/` in a browser.
