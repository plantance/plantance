import { spawnStreaming } from "../util/proc.js";
import { diffWorkspace } from "../util/workspace.js";
import { resolveGooseBinary } from "./gooseBinary.js";
import type { AgentEngine, AgentTask, AgentResult } from "./AgentEngine.js";
import type { ModelConfig, Provider } from "./types.js";

/** Provider → Goose provider id + the env var it reads the key from. */
const PROVIDER_ENV: Record<Provider, { gooseProvider: string; keyVar?: string }> = {
  anthropic: { gooseProvider: "anthropic", keyVar: "ANTHROPIC_API_KEY" },
  openai: { gooseProvider: "openai", keyVar: "OPENAI_API_KEY" },
  ollama: { gooseProvider: "ollama" }, // keyless (local)
};

/**
 * Drives the BUNDLED Goose binary headlessly (spec §6). Configures provider/
 * model/key per-run via env — never touches the user's global Goose config.
 * The binary ships inside the app (sidecar); resolveGooseBinary() finds it.
 */
export class GooseEngine implements AgentEngine {
  name = "goose";

  async preflight(model: ModelConfig): Promise<{ ok: boolean; reason?: string }> {
    const bin = resolveGooseBinary();
    const ver = await spawnStreaming(bin.path, ["--version"], { timeoutMs: 30_000 });
    if (ver.code !== 0) {
      return {
        ok: false,
        reason: bin.bundled
          ? "The bundled AI engine failed to start."
          : "The AI engine isn't available. (Run `npm run fetch:goose` in dev.)",
      };
    }
    const cfg = PROVIDER_ENV[model.provider];
    if (cfg.keyVar && !model.apiKey) {
      return { ok: false, reason: `No ${model.provider} API key set.` };
    }
    return { ok: true };
  }

  async run(task: AgentTask, onLog: (line: string) => void): Promise<AgentResult> {
    const bin = resolveGooseBinary();
    const cfg = PROVIDER_ENV[task.model.provider];

    // Headless one-shot: read instruction from stdin (-i -), no saved session,
    // quiet, capped turns (feeds our budget caps §7). CWD = scoped workspace so
    // Goose can only touch that dir (§10).
    const args = [
      "run",
      "-i",
      "-",
      "--no-session",
      "-q",
      "--provider",
      cfg.gooseProvider,
      "--model",
      task.model.model,
      "--max-turns",
      "30",
    ];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GOOSE_PROVIDER: cfg.gooseProvider,
      GOOSE_MODEL: task.model.model,
    };
    if (cfg.keyVar && task.model.apiKey) env[cfg.keyVar] = task.model.apiKey;

    const { code, log, timedOut } = await spawnStreaming(bin.path, args, {
      cwd: task.workspaceDir,
      env,
      timeoutMs: task.timeoutMs,
      onLine: onLog,
      input: task.instruction,
    });

    const filesTouched = await diffWorkspace(task.workspaceDir);
    return {
      ok: code === 0,
      summary: extractSummary(log),
      filesTouched,
      rawLog: log,
      error: timedOut
        ? "The AI engine ran past its time limit and was stopped."
        : code === 0
          ? undefined
          : "The AI engine exited with an error.",
    };
  }
}

/** Best-effort last-meaningful-line summary of what the agent did. */
function extractSummary(log: string): string {
  const lines = log
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.at(-1) ?? "";
}
