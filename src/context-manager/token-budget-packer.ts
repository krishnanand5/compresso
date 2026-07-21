import type { ArtifactRecord } from './artifact-store.js';
import type { ContextPacketItem } from './types.js';

export class TokenBudgetPacker {
  private charsPerToken: number;

  constructor(charsPerToken = 3.7) {
    this.charsPerToken = charsPerToken;
  }

  pack(records: ArtifactRecord[], budgetTokens: number, reasonOverride?: string): ContextPacketItem[] {
    if (budgetTokens <= 0 || records.length === 0) return [];

    const items: ContextPacketItem[] = [];
    let remainingTokens = budgetTokens;

    for (const rec of records) {
      if (remainingTokens <= 0) break;

      const estimatedTokens = Math.ceil(rec.content.length / this.charsPerToken);

      if (estimatedTokens <= remainingTokens) {
        items.push(this.toItem(rec, reasonOverride));
        remainingTokens -= estimatedTokens;
      } else if (remainingTokens > 0) {
        const truncated = this.truncate(rec.content, remainingTokens);
        if (truncated.length > 0) {
          items.push({
            type: rec.artifact.type,
            content: truncated,
            sourcePath: rec.artifact.sourcePath,
            commit: rec.artifact.sourceCommit,
            timestamp: rec.artifact.createdAt,
            reasonSelected: reasonOverride ?? `truncated to fit budget (${remainingTokens} tokens remaining)`,
          });
          remainingTokens = 0;
        }
      }
    }

    return items;
  }

  private toItem(rec: ArtifactRecord, reasonOverride?: string): ContextPacketItem {
    return {
      type: rec.artifact.type,
      content: rec.content,
      sourcePath: rec.artifact.sourcePath,
      commit: rec.artifact.sourceCommit,
      timestamp: rec.artifact.createdAt,
      reasonSelected: reasonOverride ?? `selected by retrieval cascade (${rec.artifact.type})`,
    };
  }

  private truncate(content: string, maxTokens: number): string {
    const maxChars = Math.floor(maxTokens * this.charsPerToken);
    if (content.length <= maxChars) return content;

    const lines = content.split('\n');

    if (lines.length <= 3) {
      return content.slice(0, maxChars) + '\n[... truncated ...]';
    }

    const header = lines.slice(0, Math.max(1, Math.floor(lines.length * 0.4))).join('\n');
    const tail = lines.slice(-Math.max(1, Math.floor(lines.length * 0.1))).join('\n');
    const result = `${header}\n[... ${lines.length - Math.floor(lines.length * 0.5)} lines omitted ...]\n${tail}`;

    return result.length > maxChars ? result.slice(0, maxChars) + '\n[... truncated ...]' : result;
  }
}
