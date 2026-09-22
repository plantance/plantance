#!/usr/bin/env node
/**
 * Fetches the pinned Goose CLI binary for this platform and extracts it into
 * vendor/bin/. Kept OUT of git (259 MB). Run in dev (`npm run fetch:goose`);
 * the Tauri bundler calls the same script at package time to place the
 * platform binary as a sidecar (spec §17 native packaging, path-2 sidecar).
 */
import { mkdir, rm, chmod, access } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Pin the version so nothing drifts under us (spec §15).
const GOOSE_VERSION = "1.51.0";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const VENDOR_BIN = join(REPO_ROOT, "vendor", "bin");

/** node platform+arch → Goose release target triple + archive extension. */
const TARGETS = {
  "darwin-arm64": { triple: "aarch64-apple-darwin", ext: "tar.bz2" },
  "darwin-x64": { triple: "x86_64-apple-darwin", ext: "tar.bz2" },
  "linux-x64": { triple: "x86_64-unknown-linux-gnu", ext: "tar.bz2" },
  "linux-arm64": { triple: "aarch64-unknown-linux-gnu", ext: "tar.bz2" },
  "win32-x64": { triple: "x86_64-pc-windows-msvc", ext: "zip" },
};

const key = `${process.platform}-${process.arch}`;
const target = TARGETS[key];
if (!target) {
  console.error(`Unsupported platform: ${key}`);
  process.exit(1);
}

const binName = process.platform === "win32" ? "goose.exe" : "goose";
const outPath = join(VENDOR_BIN, binName);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (await exists(outPath) && !process.argv.includes("--force")) {
    console.log(`goose already vendored at ${outPath} (use --force to refetch)`);
    return;
  }
  await mkdir(VENDOR_BIN, { recursive: true });

  const asset = `goose-${target.triple}.${target.ext}`;
  const url = `https://github.com/block/goose/releases/download/v${GOOSE_VERSION}/${asset}`;
  const archive = join(VENDOR_BIN, asset);

  console.log(`Downloading Goose ${GOOSE_VERSION} for ${key}…\n  ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(archive));

  console.log("Extracting…");
  if (target.ext === "zip") {
    run("unzip", ["-o", archive, "-d", VENDOR_BIN]);
  } else {
    run("tar", ["xjf", archive, "-C", VENDOR_BIN]);
  }
  await rm(archive, { force: true });
  if (process.platform !== "win32") await chmod(outPath, 0o755);

  console.log(`✓ goose ready at ${outPath}`);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
