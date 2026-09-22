import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Run } from "./run.js";
import { checkBudget, CAPS } from "./budget.js";
import { createWorkspace, seedWorkspace, PLANTANCE_HOME } from "../util/workspace.js";
import type { Deployer } from "../deploy/Deployer.js";
import type { Verifier } from "../verify/Verifier.js";
import type { AgentEngine } from "../engine/AgentEngine.js";
import type { ModelConfig } from "../engine/types.js";

export interface PipelineDeps {
  deployer: Deployer;
  verifier: Verifier;
  /** known-good app to seed the workspace with (M1 fallback / M2+ safety net) */
  fixtureDir: string;
  dbName: string;
  /** M2+: the agent that builds the app. Omit to always use the fixture. */
  engine?: AgentEngine;
  /** BYOK config for the engine (its own key — not Claude Code's login). */
  model?: ModelConfig | null;
  /** the rendered build instruction (M3: from the pack). */
  buildInstruction?: string;
}

/**
 * The outer loop (spec §7). Failures are handled as states, not exceptions.
 * M1 wires PLAN→VERIFY_LOCAL→PROVISION→DEPLOY→VERIFY_LIVE against a hand-written
 * fixture (no agent). BUILD / FIX_* land with the engine in M2+.
 */
export async function runPipeline(run: Run, deps: PipelineDeps): Promise<void> {
  const { deployer, verifier, fixtureDir, dbName, engine, model, buildInstruction } = deps;
  try {
    // INTAKE → PLAN
    run.setState("PLAN");
    run.emitLog("step", "Setting up a private workspace for your app…");
    const ws = await createWorkspace(run.id);

    // BUILD — the agent builds in the scoped workspace when an engine + key are
    // available; otherwise seed the known-good fixture (M1 path, no agent).
    run.setState("BUILD");
    const useAgent = engine && model?.apiKey && buildInstruction;
    if (useAgent) {
      run.emitLog("step", "Designing and building your app…");
      run.budget.agentRuns++;
      const result = await engine.run(
        { workspaceDir: ws.dir, instruction: buildInstruction, model, timeoutMs: CAPS.maxWallClockMs },
        (line) => run.appendTech(line),
      );
      if (!result.ok) {
        return failSoft(run, "I couldn't finish building the app. " + (result.error ?? ""));
      }
    } else {
      run.emitLog("step", "Preparing your app…");
      await seedWorkspace(ws, fixtureDir);
    }

    if (bail(run)) return failSoft(run, budgetMsg(run));

    // VERIFY_LOCAL
    run.setState("VERIFY_LOCAL");
    run.emitLog("step", "Checking the app builds and runs on your machine…");
    const local = await verifier.verifyLocal(ws.dir, (l) => run.appendTech(l));
    if (!local.ok) {
      return failSoft(run, "I couldn't get the app to build locally. " + local.reason);
    }
    run.emitLog("success", "The app builds and runs locally.");

    // Deploy preflight — is the user connected to their own account?
    const pre = await deployer.preflight();
    if (!pre.loggedIn) {
      run.emitLog(
        "info",
        "Next, connect your free Cloudflare account so the app can go live in your name.",
      );
      return failSoft(
        run,
        pre.reason ??
          "You're not connected to Cloudflare yet. Click “Connect Cloudflare” to continue.",
      );
    }

    if (bail(run)) return failSoft(run, budgetMsg(run));

    // PROVISION
    run.setState("PROVISION");
    run.emitLog("step", "Setting up your database…");
    await deployer.provision(ws.dir, dbName, (l) => run.appendTech(l));

    // DEPLOY
    run.setState("DEPLOY");
    run.emitLog("step", "Publishing your app to the internet…");
    const deployed = await deployer.deploy(ws.dir, dbName, (l) => run.appendTech(l));

    // VERIFY_LIVE
    run.setState("VERIFY_LIVE");
    run.emitLog("step", "Making sure your live app actually works…");
    const live = await verifier.verifyLive(deployed.url);
    if (!live.ok) {
      return failSoft(run, "The app published but isn't serving correctly yet. " + live.reason);
    }

    // DONE
    run.result = {
      url: deployed.url,
      dbName: deployed.dbName,
      account: deployed.account,
    };
    run.setState("DONE");
    run.emitLog("success", `It's live! ${deployed.url}`);
    run.emitLog("info", "This is yours — it lives in your own Cloudflare account.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    run.appendTech(`[unhandled] ${msg}`);
    await failSoft(run, "Something went wrong I didn't expect. You can try again.");
  }
}

function bail(run: Run): boolean {
  return checkBudget(run.budget) !== null;
}

function budgetMsg(run: Run): string {
  return checkBudget(run.budget) ?? "Stopped to protect your account.";
}

/**
 * FAIL_SOFT (spec §7): plain-language message to the user, full technical
 * detail to a file for the operator. Never a raw stack trace in their face.
 */
async function failSoft(run: Run, message: string): Promise<void> {
  const techLogPath = join(PLANTANCE_HOME, `run-${run.id}.log`);
  try {
    await writeFile(techLogPath, run.techLog, "utf8");
  } catch {
    /* best effort */
  }
  run.result = { message, techLogPath };
  run.setState("FAIL_SOFT");
  run.emitLog("error", message);
}
