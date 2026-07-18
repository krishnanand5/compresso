import { execSync } from 'child_process';
import type { TaskState, ContextPacket } from '../../context-manager/types.js';

export function captureTaskState(cwd: string, sessionId: string): TaskState {
  return {
    sessionId,
    branch: safeGit(cwd, 'rev-parse --abbrev-ref HEAD') || 'unknown',
    headCommit: safeGit(cwd, 'rev-parse HEAD') || 'unknown',
    activeFiles: extractActiveFiles(cwd),
    activeTask: null,
  };
}

export function injectContextPacket(
  bodyBytes: Uint8Array,
  packet: ContextPacket,
): Uint8Array {
  if (packet.items.length === 0) return bodyBytes;

  try {
    const body = JSON.parse(new TextDecoder().decode(bodyBytes));
    const contextBlock = formatContextBlock(packet);

    if (body.messages && Array.isArray(body.messages)) {
      const systemMsg = body.messages.find((m: any) => m.role === 'system');
      if (systemMsg && typeof systemMsg.content === 'string') {
        systemMsg.content = contextBlock + '\n\n' + systemMsg.content;
      } else {
        body.messages.unshift({
          role: 'system',
          content: contextBlock,
        });
      }
    }

    return new TextEncoder().encode(JSON.stringify(body));
  } catch {
    return bodyBytes;
  }
}

export function extractArtifactsFromResponse(
  responseBody: any,
  cwd: string,
  branch: string,
  commit: string,
): Array<{ type: string; content: string; path: string | null }> {
  const artifacts: Array<{ type: string; content: string; path: string | null }> = [];

  if (!responseBody?.choices) return artifacts;

  for (const choice of responseBody.choices) {
    const message = choice.message;
    if (!message?.tool_calls) continue;

    for (const call of message.tool_calls) {
      const args = safeJsonParse(call.function?.arguments ?? '{}');
      const path = args?.file_path ?? args?.path ?? null;

      artifacts.push({
        type: 'tool_output',
        content: JSON.stringify(call.function),
        path,
      });
    }
  }

  return artifacts;
}

function formatContextBlock(packet: ContextPacket): string {
  const lines: string[] = [
    '<context-manager>',
    `<!-- retrieved ${packet.items.length} items in ${packet.retrievalTimeMs}ms, ${packet.totalTokens} tokens -->`,
  ];

  for (const item of packet.items) {
    const meta = [
      item.sourcePath ? `path=${item.sourcePath}` : null,
      item.commit ? `commit=${item.commit.slice(0, 8)}` : null,
      `reason=${item.reasonSelected}`,
    ].filter(Boolean).join(', ');

    lines.push(`<context-item type="${item.type}" meta="${meta}">`);
    lines.push(item.content);
    lines.push('</context-item>');
  }

  lines.push('</context-manager>');
  return lines.join('\n');
}

function safeGit(cwd: string, args: string): string | null {
  try {
    return execSync(`git ${args}`, { cwd, encoding: 'utf-8', timeout: 2000 }).trim();
  } catch {
    return null;
  }
}

function extractActiveFiles(cwd: string): string[] {
  try {
    const output = execSync('git diff --name-only HEAD', { cwd, encoding: 'utf-8', timeout: 2000 });
    return output.trim().split('\n').filter(Boolean).map(f => `${cwd}/${f}`);
  } catch {
    return [];
  }
}

function safeJsonParse(str: string): any {
  try { return JSON.parse(str); } catch { return null; }
}
