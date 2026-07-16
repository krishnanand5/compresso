# compresso-cli

**Token-compression proxy for LLM coding agents.** Converts bulky context
(system prompts, tool docs, old conversation history) into dense PNG images,
cutting input token consumption by 60–70% on supported models.

## Features

- **Local HTTP proxy** — intercepts API calls for Claude Code, general OpenAI,
  and any client that supports `OPENAI_BASE_URL`
- **Copilot compression** — integrates via the GitHub Copilot SDK
  (`@github/copilot-sdk`) to compress `agent.js` request bodies
- **Codex CLI integration** — wraps Codex CLI with automatic proxy lifecycle
  (`compresso codex`)
- **Dashboard** — real-time token savings, per-session breakdown, model chips
- **Multiple model support** — Claude Fable 5 (default) and GPT 5.6 family
  (Sol, Terra, Luna) enabled out of the box; others opt-in via
  `COMPRESSO_MODELS`

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

### Dashboard

```bash
compresso dashboard                # terminal UI with live stats
```

Visit `http://127.0.0.1:47821/` in a browser for the same dashboard.

## How it works

The proxy intercepts requests, identifies bulky content (system prompts,
tool schemas, old history), renders it into PNG images using a bitmap font
atlas, and inserts the images as `input_image` / `image_url` parts. The
model reads the images via its vision channel — same mechanism as
screenshots or uploaded images.

```
incoming request ──► image eligible bulk ──► PNG render ──► forward to API
```

Token cost is fixed by pixel dimensions, not text length. A typical page
holds ~3,000 characters at ~1,100 image tokens — ~3× denser than the text
equivalent.

## Model scope

| Model family | Default | Notes |
|---|---|---|
| `claude-fable-5` | Enabled | Default, highest quality |
| `gpt-5.6-sol` | Enabled | Dedicated render profile |
| `gpt-5.6-terra` | Enabled | Uses generic 5.x profile |
| `gpt-5.6-luna` | Enabled | Uses generic 5.x profile |
| Everything else | Opt-in | Set `COMPRESSO_MODELS` or toggle dashboard |

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
