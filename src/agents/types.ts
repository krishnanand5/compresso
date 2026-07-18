// src/agents/types.ts

/** Two flavors of coding-agent integration. */
export type AgentFamily = 'base-url' | 'sdk';

/** Environment variables map for agents. */
export type AgentEnv = Record<string, string>;

/** Interface for agents that use a base URL (e.g., Codex, OpenCode). */
export interface BaseUrlAgent {
  readonly id: string;
  readonly displayName: string;
  readonly family: 'base-url';
  /** CLI binary name. */
  readonly binaryName: string;
  /** Default port for the proxy. */
  readonly defaultPort: number;
  /** Model prefixes that the agent supports (e.g. 'gpt-5.6', 'claude-5').
   *  Used to determine multimodal compatibility. */
  readonly supportedModels: string[];
  /** Generate env vars given the proxy port. */
  envVars(port: number): AgentEnv;
  /** Optional config writer. */
  writeConfig?(opts: { port: number; apiKey?: string; model?: string }): Promise<void>;
  /** Optional argv parser. */
  parseArgv?(argv: readonly string[]): AgentArgv;
  /** Optional help text. */
  helpText?: string;
}

/** Interface for agents that run in-process via an SDK handler. */
export interface SdkAgent {
  readonly id: string;
  readonly displayName: string;
  readonly family: 'sdk';
  /** Model prefixes that the agent supports (e.g. 'gpt-5.6', 'claude-5').
   *  Used to determine multimodal compatibility. */
  readonly supportedModels: string[];
  /** Build a request handler bound to compression options. */
  makeHandler(opts: { transform: import('../core/utils.js').TransformOptions }): unknown;
  /** Optional argv parser. */
  parseArgv?(argv: readonly string[]): AgentArgv;
  helpText?: string;
}

/** Discriminated union of coding agents. */
export type CodingAgent = BaseUrlAgent | SdkAgent;

/** Common argv shape returned by every agent's parseArgv. */
export interface AgentArgv {
  readonly help: boolean;
  readonly setup: boolean;
  readonly port: number;
  readonly model?: string;
  readonly apiKey?: string;
  readonly prompt?: string;
  readonly quiet?: boolean;
  /** Agent‑specific extra flags. */
  readonly extra: Record<string, unknown>;
}
