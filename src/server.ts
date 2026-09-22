import express, { type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Run, type LogLine, type RunState } from "./orchestrator/run.js";
import { runPipeline } from "./orchestrator/stateMachine.js";
import { CloudflareDeployer } from "./deploy/CloudflareDeployer.js";
import { Verifier } from "./verify/Verifier.js";
import { KeyStore } from "./keys/KeyStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const UI_DIR = join(REPO_ROOT, "ui");
const FIXTURE_DIR = join(REPO_ROOT, "fixtures", "hello-static");
const DB_NAME = "plantance-demo";

export function createServer() {
  const app = express();
  app.use(express.json());
  app.use(express.static(UI_DIR));

  const deployer = new CloudflareDeployer();
  const verifier = new Verifier();
  const keys = new KeyStore();

  /** Only one Run at a time in the MVP — keep it dead simple. */
  let current: Run | null = null;

  // Setup status for the first-run screen.
  app.get("/status", async (_req: Request, res: Response) => {
    const model = await keys.get();
    const pre = await deployer.preflight().catch(() => ({ loggedIn: false }));
    res.json({ hasKey: !!model?.apiKey, cloudflareConnected: pre.loggedIn });
  });

  app.post("/key", async (req: Request, res: Response) => {
    const { apiKey } = req.body ?? {};
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      return res.status(400).json({ ok: false, reason: "Paste a valid key." });
    }
    await keys.set({ provider: "anthropic", model: "claude-sonnet-4-5", apiKey: apiKey.trim() });
    res.json({ ok: true });
  });

  // Drive `wrangler login` — streams to the current run log if one is open.
  app.post("/connect-cloudflare", async (_req: Request, res: Response) => {
    const result = await deployer.login((l) => current?.appendTech(l));
    res.json({ ok: result.loggedIn, reason: result.reason });
  });

  // Start a Run.
  app.post("/run", (req: Request, res: Response) => {
    if (current && !isTerminal(current.state)) {
      return res.status(409).json({ ok: false, reason: "A build is already running." });
    }
    const run = new Run();
    current = run;
    res.json({ ok: true, runId: run.id });
    // fire-and-forget; the UI follows via /events
    void runPipeline(run, { deployer, verifier, fixtureDir: FIXTURE_DIR, dbName: DB_NAME });
  });

  // SSE: stream the current run's log + state.
  app.get("/events", (_req: Request, res: Response) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const run = current;
    if (!run) {
      res.write(`event: idle\ndata: {}\n\n`);
      return;
    }
    // replay history, then live
    for (const line of run.log) send(res, "log", line);
    send(res, "state", { state: run.state });

    const onLog = (line: LogLine) => send(res, "log", line);
    const onState = (state: RunState) => {
      send(res, "state", { state });
      if (isTerminal(state)) send(res, "result", run.result);
    };
    run.on("log", onLog);
    run.on("state", onState);
    res.on("close", () => {
      run.off("log", onLog);
      run.off("state", onState);
    });
  });

  return app;
}

function send(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function isTerminal(state: RunState): boolean {
  return state === "DONE" || state === "FAIL_SOFT";
}
