import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnStreaming } from "../util/proc.js";
import type {
  Deployer,
  PreflightResult,
  ProvisionResult,
  DeployResult,
} from "./Deployer.js";

/**
 * Deploys into the USER'S OWN Cloudflare account (spec §9). Only ever invokes
 * `wrangler` (allowlist, §10). Flags verified against wrangler 4.136.2 (§15).
 *
 * NOTE: the live path (provision/deploy) needs the user logged into their own
 * account. Until that exists, preflight() reports loggedIn:false and the state
 * machine stops with a plain-language "connect Cloudflare" message.
 */
export class CloudflareDeployer implements Deployer {
  name = "cloudflare";

  private wrangler(
    args: string[],
    cwd: string,
    onLog: (line: string) => void,
    input?: string,
  ) {
    return spawnStreaming("npx", ["wrangler", ...args], {
      cwd,
      onLine: onLog,
      timeoutMs: 5 * 60_000,
      input,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
  }

  async preflight(): Promise<PreflightResult> {
    const res = await spawnStreaming("npx", ["wrangler", "whoami"], {
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      timeoutMs: 60_000,
    });
    const loggedIn =
      res.code === 0 && !/not authenticated|you are not logged in/i.test(res.log);
    if (!loggedIn) {
      return {
        ok: false,
        loggedIn: false,
        reason:
          "You're not connected to Cloudflare yet. Click “Connect Cloudflare” to sign in to your free account.",
      };
    }
    return { ok: true, loggedIn: true, account: parseAccount(res.log) };
  }

  async login(onLog: (line: string) => void): Promise<PreflightResult> {
    // Opens a browser for the user to authorize THEIR OWN account; wrangler
    // stores the token locally. We never see or hold their credentials (§9).
    await spawnStreaming("npx", ["wrangler", "login"], {
      onLine: onLog,
      timeoutMs: 5 * 60_000,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
    return this.preflight();
  }

  async provision(
    projectDir: string,
    dbName: string,
    onLog: (line: string) => void,
  ): Promise<ProvisionResult> {
    const created = await this.wrangler(["d1", "create", dbName], projectDir, onLog);
    // Idempotent: if the DB already exists, reuse it instead of failing.
    let databaseId = parseDatabaseId(created.log);
    if (created.code !== 0 || !databaseId) {
      databaseId = await this.findDatabaseId(dbName, projectDir, onLog);
    }
    if (!databaseId) throw new Error(`Failed to create or find database "${dbName}".`);

    await patchWranglerDbBinding(projectDir, dbName, databaseId);

    // Non-interactive: auto-confirm the migration prompt.
    const migrated = await this.wrangler(
      ["d1", "migrations", "apply", dbName, "--remote"],
      projectDir,
      onLog,
      "y\n",
    );
    if (migrated.code !== 0) throw new Error("Failed to set up the database tables.");

    return { dbName, databaseId };
  }

  async deploy(
    projectDir: string,
    dbName: string,
    onLog: (line: string) => void,
  ): Promise<DeployResult> {
    const projectName = dbName; // one name for both keeps the mapping obvious

    // Idempotent + transient-tolerant: Cloudflare occasionally returns a
    // spurious [code: 8000000] on a brand-new account's first Pages call.
    // Create if missing (ignore "already exists"), retrying transient errors.
    await this.ensureProject(projectName, projectDir, onLog);

    const deployed = await retry(3, () =>
      this.wrangler(
        ["pages", "deploy", "dist", "--project-name", projectName, "--branch", "main"],
        projectDir,
        onLog,
      ).then((r) => {
        if (r.code !== 0) throw new Error("Publishing to Cloudflare failed.");
        return r;
      }),
    );

    const url = parsePagesUrl(deployed.log);
    if (!url) throw new Error("Deploy succeeded but no live URL was returned.");

    const account = (await this.preflight()).account ?? "your account";
    return { url, dbName, account };
  }

  /**
   * Look up an existing D1 database's id by name (for idempotent re-runs).
   * Uses `d1 list --json` — config-independent, so a placeholder database_id in
   * the project's wrangler.toml can't mislead it (unlike `d1 info`).
   */
  private async findDatabaseId(
    dbName: string,
    projectDir: string,
    onLog: (line: string) => void,
  ): Promise<string | null> {
    const listed = await this.wrangler(["d1", "list", "--json"], projectDir, onLog);
    try {
      const start = listed.log.indexOf("[");
      const end = listed.log.lastIndexOf("]");
      if (start < 0 || end < 0) return null;
      const rows = JSON.parse(listed.log.slice(start, end + 1)) as {
        uuid: string;
        name: string;
      }[];
      return rows.find((r) => r.name === dbName)?.uuid ?? null;
    } catch {
      return null;
    }
  }

  /** Create the Pages project if missing; ignore "already exists"; retry transient. */
  private async ensureProject(
    projectName: string,
    projectDir: string,
    onLog: (line: string) => void,
  ): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await this.wrangler(
        ["pages", "project", "create", projectName, "--production-branch", "main"],
        projectDir,
        onLog,
      );
      if (r.code === 0 || /already exists/i.test(r.log)) return;
      if (attempt < 3) await sleep(2000 * attempt);
    }
    // Don't throw — a real "project does not exist" surfaces at deploy time.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Retry an async op on thrown error, with linear backoff. */
async function retry<T>(times: number, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= times; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < times) await sleep(2000 * i);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

// --- parsing helpers (output shapes verified against wrangler 4.x) ---

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function parseDatabaseId(log: string): string | null {
  // wrangler prints e.g.  database_id = "xxxx"  or  "database_id": "xxxx"
  const tagged = log.match(/database_id["\s:=]*"([0-9a-f-]{36})"/i);
  if (tagged?.[1]) return tagged[1];
  const bare = log.match(UUID);
  return bare?.[0] ?? null;
}

export function parsePagesUrl(log: string): string | null {
  // e.g. https://c527a33e.plantance-demo.pages.dev — allow multi-label subdomains
  const m = log.match(/https:\/\/[a-z0-9.-]+\.pages\.dev/i);
  return m?.[0] ?? null;
}

export function parseAccount(log: string): string | undefined {
  const m = log.match(/associated with the email\s+([^\s]+)/i) ?? log.match(/[\w.+-]+@[\w.-]+/);
  return m?.[1] ?? m?.[0];
}

/** Rewrite the D1 binding block in wrangler.toml with the real database_id. */
async function patchWranglerDbBinding(
  projectDir: string,
  dbName: string,
  databaseId: string,
): Promise<void> {
  const path = join(projectDir, "wrangler.toml");
  let toml = await readFile(path, "utf8");
  if (/database_id\s*=/.test(toml)) {
    toml = toml.replace(/database_id\s*=\s*".*?"/, `database_id = "${databaseId}"`);
  } else {
    toml += `\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${dbName}"\ndatabase_id = "${databaseId}"\n`;
  }
  toml = toml.replace(/database_name\s*=\s*".*?"/, `database_name = "${dbName}"`);
  await writeFile(path, toml, "utf8");
}
