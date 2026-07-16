# compresso-cli

**Token-compression proxy for LLM coding agents.** Converts bulky context
(system prompts, tool docs, old conversation history) into dense PNG images,
cutting input token consumption by 60–70% on supported models.

## Features

- **Local HTTP proxy** — intercepts API calls for Claude Code, general OpenAI,
  OpenCode Zen, and any client that supports `OPENAI_BASE_URL`
- **Copilot compression** — integrates via the GitHub Copilot SDK
  (`@github/copilot-sdk`) to compress `agent.js` request bodies
- **Codex CLI integration** — wraps Codex CLI with automatic proxy lifecycle
  (`compresso codex`)
- **OpenCode integration** — wraps OpenCode with automatic proxy lifecycle
  (`compresso opencode`)
- **Dashboard** — real-time token savings, per-session breakdown, model chips
- **Multiple model support** — Claude Fable 5 (default) and GPT 5.6 family
  (Sol, Terra, Luna) enabled out of the box; others opt-in via
  `COMPRESSO_MODELS`
- **History collapse** — long-running conversations image older turns into
  dense PNGs, preventing the accumulated context from diluting savings
- **Render cache** — filesystem LRU cache avoids re-rendering identical
  content across requests and restarts

## Installation

```bash
# Install from the shared .tgz (not yet published to npm)
npm install -g ./compresso-cli-v0.1.0.tgz

# Verify
compresso --version
```

npm runtime dependencies (`@github/copilot-sdk`, `gpt-tokenizer`, etc.)
resolve from the public registry automatically.

## Quick start

### Proxy (general use)

```bash
compresso proxy                    # starts on 127.0.0.1:47821
```

Point any OpenAI/Anthropic client at the proxy:

```bash
OPENAI_BASE_URL=http://127.0.0.1:47821 codex
ANTHROPIC_BASE_URL=http://127.0.0.1:47821 claude
```

### Copilot

```bash
compresso copilot                  # start compressed Copilot session
compresso copilot "write a test"   # single-shot prompt
```

### Codex CLI

```bash
compresso codex                    # spawns proxy + Codex CLI
compresso codex --setup            # write persistent ~/.codex/config.toml
```

### OpenCode

```bash
compresso opencode                 # spawns proxy + OpenCode
compresso opencode --model big-pickle  # use a specific model
compresso opencode --debug         # verbose request logging
compresso opencode --setup         # write persistent config
```

### Dashboard

```bash
compresso dashboard                # terminal UI with live stats
```

Visit `http://127.0.0.1:47821/` in a browser for the same dashboard.

## How it works

The proxy intercepts requests and identifies bulky content. **Static context**
(system prompts, tool docs, tool schemas) is rendered into PNG images using a
bitmap font atlas and inserted as `image_url` / `input_image` parts. For
conversations longer than ~8 turns, **history collapse** images older user,
assistant, and tool messages into dense PNG strips — preventing the accumulated
context from diluting token savings. A filesystem LRU cache avoids re-rendering
identical content across requests and restarts.

The model reads the images via its vision channel — same mechanism as
screenshots or uploaded images.

```
incoming request ──► static slab ──► history collapse ──► PNG render ──► cache look-up ──► forward to API
```

Token cost is fixed by pixel dimensions, not text length. A typical page
holds ~3,000 characters at ~1,100 image tokens — ~3× denser than the text
equivalent.

## Model scope

Compression renders text into PNGs and inserts them as image parts, so only
**image-capable** (multimodal) models can receive compressed requests. Text-only
models in the allowlist are passed through without compression.

| Model | Default | Compression |
|---|---|---|
| `claude-fable-5` | Enabled | Image-capable |
| `gpt-5.6-sol` | Enabled | Image-capable |
| `gpt-5.6-terra` | Enabled | Image-capable |
| `gpt-5.6-luna` | Enabled | Image-capable |
| `claude-5` | Enabled | Image-capable |
| `big-pickle` | Enabled | Image-capable |
| `deepseek-v4-flash` | Enabled | Text-only (passthrough) |
| `nemotron-3-ultra` | Enabled | Text-only (passthrough) |
| Everything else | Opt-in | Set `COMPRESSO_MODELS` or toggle dashboard |

## Render cache

Rendered PNGs are cached on disk at `~/.compresso/cache/` so identical content
(system prompts, tool docs, frozen history sections) is never re-rendered across
requests or restarts. The cache uses an LRU eviction policy:

- **Caps:** 1000 entries or 500 MB (configurable)
- **Key:** SHA-256 of normalized text + render parameters
- **Atomic writes:** temp file + rename
- **Eviction:** coldest 10% removed when either cap is exceeded

```bash
compresso cache stats              # entry count + total disk usage
compresso cache clean              # wipe entire cache
compresso cache prune              # evict coldest 25% of entries
```

Environment variables: `COMPRESSO_CACHE_DIR`, `COMPRESSO_CACHE_MAX_FILES`,
`COMPRESSO_CACHE_MAX_BYTES`.

## Documentation

- [Codex CLI integration](docs/CODEX_CLI_INTEGRATION.md)
- [Token savings analysis](docs/CACHING_AND_SAVINGS.md)
- [Model render profiles](docs/MODEL_RENDER_PROFILES.md)
- [Inspiration and background](docs/INSPIRATION.md)

## Development

```bash
pnpm install
pnpm run build              # compile dist/ bundles
pnpm test                   # run tests
pnpm run bundle             # produce .tgz for sharing
```

## License

MIT.
