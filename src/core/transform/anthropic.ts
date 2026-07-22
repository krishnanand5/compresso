import type { Transformer } from './types.js';
import { registerTransformer } from './registry.js';
import type { TransformOptions, TransformInfo } from '../utils.js';
import { renderTextToPngs, shrinkColsToContent } from '../render.js';
import type { RenderedImage } from '../render.js';
import { compactSlabWhitespace, sha8 } from '../utils.js';
import { resolveGptProfile } from '../gpt-model-profiles.js';
import { evalOpenAIGate } from '../openai.js';
import { getModelCostMultiplier } from '../image-cost-cache.js';
import { countTokens } from '../count-tokens.js';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string | Array<{ type: string; text?: string; cache_control?: { type: string }; [key: string]: unknown }>;
  messages: AnthropicMessage[];
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
    cache_control?: { type: string };
  }>;
  [key: string]: unknown;
}

function contentText(content: string | Array<{ type: string; text?: string; [key: string]: unknown }>): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n\n');
}

function firstUserText(req: AnthropicRequest): string {
  for (const msg of req.messages) {
    if (msg.role === 'user') {
      return contentText(msg.content);
    }
  }
  return '';
}

function anthropicImagePart(img: RenderedImage): { type: 'image'; source: { type: 'base64'; media_type: string; data: string } } {
  const b64 = Buffer.from(img.png).toString('base64');
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: b64,
    },
  };
}

function emptyInfo(): TransformInfo {
  return {
    compressed: false,
    origChars: 0,
    compressedChars: 0,
    imageCount: 0,
    imageBytes: 0,
    staticChars: 0,
    dynamicChars: 0,
    dynamicBlockCount: 0,
  };
}

const ANTHROPIC_HEADER = `## COMPRESSED CONTEXT
The following content has been rendered as images for token efficiency.
Read the images carefully — they contain verbatim tool definitions, system instructions, and context.

====\n\n`;

const ANTHROPIC_POINTER = 'The full instructions for this message were rendered into image(s) attached to the first user message by compresso. Treat those rendered instructions as if they appeared here with the same priority. Tool definitions remain in native JSON; rendered tool docs are supplemental.';

export async function transformAnthropicMessages(input: {
  body: Uint8Array;
  model: string;
  opts: TransformOptions;
  upstreamUrl?: string;
  apiKey?: string;
}): Promise<{ body: Uint8Array; info: TransformInfo }> {
  const { body, model, opts, upstreamUrl, apiKey } = input;
  const o = {
    compress: opts.compress ?? true,
    compressTools: opts.compressTools ?? true,
    minCompressChars: opts.minCompressChars ?? 2000,
    cols: opts.cols,
    reflow: opts.reflow ?? true,
    cache: opts.cache,
  };
  const info = emptyInfo();
  if (!o.compress) {
    info.reason = 'compress=false';
    return { body, info };
  }

  let req: AnthropicRequest;
  try {
    req = JSON.parse(new TextDecoder().decode(body));
  } catch (e) {
    info.reason = `parse_error: ${(e as Error).message}`;
    return { body, info };
  }

  if (!Array.isArray(req.messages)) {
    info.reason = 'parse_error: messages must be an array';
    return { body, info };
  }

  // Get exact token count from upstream if available
  let exactTokenCount: number | undefined;
  if (upstreamUrl && apiKey) {
    // Strip the /messages or /chat/completions path to get the base URL
    const baseMatch = upstreamUrl.match(/^(https?:\/\/[^/]+(?:\/zen\/go)?\/v1)/);
    if (baseMatch) {
      const countReq = {
        model,
        system: req.system,
        messages: req.messages,
        tools: req.tools,
      };
      const key: string = apiKey ?? '';
      exactTokenCount = await countTokens(baseMatch[1] as string, key as string, countReq);
      if (exactTokenCount !== undefined) {
        info.baselineProbeStatus = 'ok';
      }
    }
  }

  const firstUserIdx = req.messages.findIndex((m) => m.role === 'user');
  if (firstUserIdx < 0) {
    info.reason = 'no_user_message';
    return { body, info };
  }

  const systemTexts: string[] = [];
  let hasCacheControl = false;

  if (typeof req.system === 'string') {
    systemTexts.push(req.system);
    info.staticChars += req.system.length;
  } else if (Array.isArray(req.system)) {
    for (const block of req.system) {
      if (block.type === 'text' && typeof block.text === 'string') {
        systemTexts.push(block.text);
        info.staticChars += block.text.length;
      }
      if (block.cache_control) hasCacheControl = true;
    }
  }

  const toolTexts: string[] = [];
  if (o.compressTools && Array.isArray(req.tools)) {
    for (const tool of req.tools) {
      const parts: string[] = [];
      parts.push(`## Tool: ${tool.name}`);
      if (tool.description) parts.push(tool.description);
      parts.push(`\`\`\`json\n${JSON.stringify(tool.input_schema, null, 2)}\n\`\`\``);
      const toolText = parts.join('\n\n');
      toolTexts.push(toolText);
      info.staticChars += toolText.length;
    }
  }

  const combinedRaw = [...systemTexts, ...toolTexts].filter((s) => s.length > 0).join('\n\n');
  info.origChars = combinedRaw.length;

  if (!combinedRaw) {
    info.reason = 'no_static_context';
    return { body, info };
  }

  const firstUser = firstUserText(req);
  if (firstUser) info.firstUserSha8 = await sha8(firstUser);

  const combined = compactSlabWhitespace(combinedRaw).trimEnd();
  const minCompressChars = o.minCompressChars ?? 2000;
  if (combined.length < minCompressChars) {
    info.reason = `below_min_chars (${combined.length} < ${minCompressChars})`;
    return { body, info };
  }

  const profile = resolveGptProfile(model);
  const maxCols = o.cols ?? profile.stripCols;
  const reflowNote = o.reflow
    ? ' The glyph ↵ (U+21B5) marks an original hard line break in content; treat it as a real newline.'
    : '';
  const header = ANTHROPIC_HEADER.replace('\n====', reflowNote + '\n====');
  const renderedText = header + combined;

  const cols = Math.min(
    shrinkColsToContent(renderedText, maxCols, profile.style.markerScale, profile.style.font),
    profile.stripCols,
  );

  const gate = evalOpenAIGate(model, renderedText, cols, 3);
  // learnedMultiplier = actualInput / baselineTokens observed from prior compressions.
  // ratio > 1.0 means imaging cost MORE than text → scale UP image estimate → gate more conservative.
  // ratio < 1.0 would mean cheaper → clamped to 1.0 by MIN_MULTIPLIER floor (never more permissive).
  // Bucket by estimated slab size so small/large slabs learn independently.
  const roughBaseline = Math.ceil(combined.length / 3);
  const learnedMultiplier = getModelCostMultiplier(model, roughBaseline);
  const adjustedImageTokens = gate.imageTokens * learnedMultiplier;
  info.gateEval = {
    site: 'slab',
    imageTokens: adjustedImageTokens,
    textTokens: gate.textTokens,
    burnImageSide: 0,
    burnTextSide: 0,
    profitable: adjustedImageTokens < gate.textTokens,
  };
  info.costMultiplier = learnedMultiplier;
  if (adjustedImageTokens >= gate.textTokens) {
    info.reason = `not_profitable (slab=${combined.length} chars, adjustedImageTokens=${Math.round(adjustedImageTokens)} > textTokens=${gate.textTokens}, multiplier=${learnedMultiplier.toFixed(2)})`;
    info.passthroughReasons = { not_profitable: 1 };
    return { body, info };
  }

  const images = await renderTextToPngs(renderedText, cols, profile.style, profile.maxHeightPx, undefined, o.cache);
  if (images.length === 0) {
    info.reason = 'render_empty';
    return { body, info };
  }

  info.compressed = true;
  info.imageCount = images.length;
  info.imageBytes = images.reduce((sum, img) => sum + img.png.length, 0);
  info.compressedChars = combined.length;
  info.baselineTokens = exactTokenCount ?? Math.ceil(combined.length / 3);
  info.baselineCacheableTokens = exactTokenCount ?? Math.ceil(combined.length / 3);

  const imageParts = images.map(anthropicImagePart);

  if (hasCacheControl && imageParts.length > 0) {
    const lastImage = imageParts[imageParts.length - 1] as { source: { type: string; media_type: string; data: string } };
    (lastImage.source as Record<string, unknown>).cache_control = { type: 'ephemeral' };
  }

  const firstUserMsg = req.messages[firstUserIdx]!;
  const existingContent: Array<{ type: string; text?: string; [key: string]: unknown }> =
    typeof firstUserMsg.content === 'string'
      ? [{ type: 'text', text: firstUserMsg.content }]
      : Array.isArray(firstUserMsg.content)
        ? firstUserMsg.content
        : [];

  const newFirstUserContent = [
    ...imageParts,
    { type: 'text', text: '[End of rendered system/tool context]' },
    ...existingContent,
  ];

  const transformed: AnthropicRequest = {
    ...req,
    system: ANTHROPIC_POINTER,
    messages: [
      ...req.messages.slice(0, firstUserIdx),
      { role: 'user' as const, content: newFirstUserContent },
      ...req.messages.slice(firstUserIdx + 1),
    ],
  };

  const outBody = new TextEncoder().encode(JSON.stringify(transformed));
  info.reason = 'compressed';
  return { body: outBody, info };
}

registerTransformer('anthropic', transformAnthropicMessages as unknown as Transformer);
