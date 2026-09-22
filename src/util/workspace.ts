import { homedir } from "node:os";
import { join, basename } from "node:path";
import { mkdir, cp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawnStreaming } from "./proc.js";

/** Root for all plantance state: projects, config. Never $HOME, never repo root (§10). */
export const PLANTANCE_HOME = join(homedir(), ".plantance");
export const PROJECTS_DIR = join(PLANTANCE_HOME, "projects");

export interface Workspace {
  id: string;
  dir: string;
}

/**
 * Scoped, git-tracked workspace for one Run. git is the seatbelt: an empty
 * snapshot before BUILD makes every run revertible + diffable (§10).
 */
export async function createWorkspace(id = randomUUID()): Promise<Workspace> {
  const dir = join(PROJECTS_DIR, id);
  await mkdir(dir, { recursive: true });
  await gitInitSnapshot(dir);
  return { id, dir };
}

const SKIP_COPY = new Set(["node_modules", "dist", ".wrangler", ".git"]);

/** Seed a workspace by copying a known-good fixture into it (used in M1). */
export async function seedWorkspace(ws: Workspace, sourceDir: string): Promise<void> {
  await cp(sourceDir, ws.dir, {
    recursive: true,
    filter: (src) => !SKIP_COPY.has(basename(src)),
  });
  await gitCommitAll(ws.dir, "seed");
}

async function gitInitSnapshot(dir: string): Promise<void> {
  await run(dir, ["init", "-q"]);
  await run(dir, ["config", "user.email", "plantance@localhost"]);
  await run(dir, ["config", "user.name", "plantance"]);
  await run(dir, ["commit", "--allow-empty", "-q", "-m", "snapshot: empty"]);
}

export async function gitCommitAll(dir: string, message: string): Promise<void> {
  await run(dir, ["add", "-A"]);
  await run(dir, ["commit", "--allow-empty", "-q", "-m", message]);
}

/** Files changed since the last commit — powers AgentResult.filesTouched (§6). */
export async function diffWorkspace(dir: string): Promise<string[]> {
  const { log } = await run(dir, ["status", "--porcelain"]);
  return log
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\S+\s+/, ""));
}

/** Undo: hard-reset to the last commit + drop untracked files. */
export async function rollback(dir: string): Promise<void> {
  await run(dir, ["reset", "--hard", "-q"]);
  await run(dir, ["clean", "-fdq"]);
}

function run(cwd: string, args: string[]) {
  return spawnStreaming("git", args, { cwd });
}
