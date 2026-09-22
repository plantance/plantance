import { spawn } from "node:child_process";
import { spawnStreaming } from "../util/proc.js";

export interface VerifyResult {
  ok: boolean;
  reason: string;
}

/** Smoke config — later comes from the pack's `verify` block (spec §8). */
export interface SmokeConfig {
  install: string[]; // e.g. ["npm", "install"]
  build: string[]; // e.g. ["npm", "run", "build"]
  previewArgs: string[]; // e.g. ["npm", "run", "preview", "--", "--port", "4321"]
  port: number;
  assertContains: string;
}

export const DEFAULT_SMOKE: SmokeConfig = {
  install: ["npm", "install"],
  build: ["npm", "run", "build"],
  previewArgs: ["npm", "run", "preview", "--", "--port", "4321", "--strictPort"],
  port: 4321,
  assertContains: '<div id="root">',
};

/**
 * VERIFY_LOCAL + VERIFY_LIVE (spec §7). A deploy that "succeeds" but serves a
 * blank/error page must be caught by verifyLive.
 */
export class Verifier {
  constructor(private readonly smoke: SmokeConfig = DEFAULT_SMOKE) {}

  async verifyLocal(dir: string, onLog: (line: string) => void): Promise<VerifyResult> {
    const install = await spawnStreaming(this.smoke.install[0]!, this.smoke.install.slice(1), {
      cwd: dir,
      onLine: onLog,
      timeoutMs: 5 * 60_000,
    });
    if (install.code !== 0) return { ok: false, reason: "Installing dependencies failed." };

    const build = await spawnStreaming(this.smoke.build[0]!, this.smoke.build.slice(1), {
      cwd: dir,
      onLine: onLog,
      timeoutMs: 5 * 60_000,
    });
    if (build.code !== 0) return { ok: false, reason: "The build step reported errors." };

    return this.smokeTest(dir, onLog);
  }

  async verifyLive(url: string): Promise<VerifyResult> {
    const res = await this.probe(url, this.smoke.assertContains, 30_000);
    return res
      ? { ok: true, reason: "" }
      : { ok: false, reason: "The live page didn't return the expected content." };
  }

  /** Boot the preview server, poll until it serves the expected content, then kill it. */
  private async smokeTest(dir: string, onLog: (line: string) => void): Promise<VerifyResult> {
    const [cmd, ...args] = this.smoke.previewArgs;
    const child = spawn(cmd!, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d: Buffer) => onLog(d.toString().trimEnd()));
    child.stderr.on("data", (d: Buffer) => onLog(d.toString().trimEnd()));
    try {
      const url = `http://localhost:${this.smoke.port}/`;
      const ok = await this.probe(url, this.smoke.assertContains, 20_000);
      return ok
        ? { ok: true, reason: "" }
        : { ok: false, reason: "The app didn't serve the expected page locally." };
    } finally {
      child.kill("SIGKILL");
    }
  }

  /** Poll a URL until it returns 200 containing `needle`, or the deadline passes. */
  private async probe(url: string, needle: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const body = await res.text();
          if (body.includes(needle)) return true;
        }
      } catch {
        /* server not up yet */
      }
      await sleep(500);
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
