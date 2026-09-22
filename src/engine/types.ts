/**
 * Provider-agnostic model config (BYOK). Keep provider open so OpenAI/Ollama
 * drop in later without touching the engine contract (spec §6, §11).
 */
export type Provider = "anthropic" | "openai" | "ollama";

export interface ModelConfig {
  provider: Provider;
  /** e.g. "claude-sonnet-4-5". Free-form; the engine adapter maps it. */
  model: string;
  /** BYOK key. Absent for keyless providers (e.g. local Ollama). */
  apiKey?: string;
}
