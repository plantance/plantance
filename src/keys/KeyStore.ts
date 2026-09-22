import { readFile, writeFile, mkdir, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { PLANTANCE_HOME } from "../util/workspace.js";
import type { ModelConfig, Provider } from "../engine/types.js";

const CONFIG_PATH = join(PLANTANCE_HOME, "config.json");

interface StoredConfig {
  provider?: Provider;
  model?: string;
  apiKey?: string;
}

/**
 * BYOK key handling (spec §11). Local-only, mode 0600, never logged, never
 * proxied. Post-MVP: move to OS keychain (keytar).
 */
export class KeyStore {
  async get(): Promise<ModelConfig | null> {
    const cfg = await this.read();
    if (!cfg.provider || !cfg.model) return null;
    return { provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey };
  }

  async set(config: ModelConfig): Promise<void> {
    await mkdir(PLANTANCE_HOME, { recursive: true });
    const data: StoredConfig = {
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
    };
    await writeFile(CONFIG_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
    await chmod(CONFIG_PATH, 0o600);
  }

  async clear(): Promise<void> {
    await rm(CONFIG_PATH, { force: true });
  }

  /**
   * Cheap test call to confirm the key works. M0: stub returns ok if a key is
   * present — a real per-provider ping lands with the engine in M2.
   */
  async validate(config: ModelConfig): Promise<{ ok: boolean; reason?: string }> {
    if (config.provider === "ollama") return { ok: true };
    if (!config.apiKey) return { ok: false, reason: "No API key set." };
    return { ok: true };
  }

  private async read(): Promise<StoredConfig> {
    try {
      return JSON.parse(await readFile(CONFIG_PATH, "utf8")) as StoredConfig;
    } catch {
      return {};
    }
  }
}
