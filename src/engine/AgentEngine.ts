import type { ModelConfig } from "./types.js";

/**
 * The contract between our outer loop and ANY agent (spec §6). Keeps the
 * "any LLM / any engine" requirement and makes the Goose-distribution pivot
 * a one-file change. M0: interface only. GooseEngine lands in M2.
 */
export interface AgentTask {
  /** scoped project dir the agent may touch (spec §10) */
  workspaceDir: string;
  /** the rendered prompt (from a pack) */
  instruction: string;
  /** provider + model + key (BYOK) */
  model: ModelConfig;
  timeoutMs: number;
}

export interface AgentResult {
  ok: boolean;
  /** agent's own summary of what it did */
  summary: string;
  filesTouched: string[];
  /** full transcript — feeds our fix-loop context */
  rawLog: string;
  error?: string;
}

export interface AgentEngine {
  name: string;
  /** Runs the agent to completion (headless). Streams lines via onLog. */
  run(task: AgentTask, onLog: (line: string) => void): Promise<AgentResult>;
  /** Health/availability check: binary installed, key valid? */
  preflight(model: ModelConfig): Promise<{ ok: boolean; reason?: string }>;
}
