import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const binName = process.platform === "win32" ? "goose.exe" : "goose";

/**
 * Resolve the bundled Goose binary (path-2 sidecar). Precedence:
 *   1. PLANTANCE_GOOSE_BIN env — set by the Tauri shell to the sidecar's
 *      resource path in the packaged .dmg/.exe (prod).
 *   2. vendor/bin/goose — fetched by scripts/fetch-goose.mjs (dev).
 *   3. `goose` on PATH — last-resort fallback for a manual install.
 *
 * The user never installs Goose; the app carries it.
 */
export function resolveGooseBinary(): { path: string; bundled: boolean } {
  const fromEnv = process.env.PLANTANCE_GOOSE_BIN;
  if (fromEnv && existsSync(fromEnv)) return { path: fromEnv, bundled: true };

  // src/engine → repo root is ../../
  const vendored = join(__dirname, "..", "..", "vendor", "bin", binName);
  if (existsSync(vendored)) return { path: vendored, bundled: true };

  return { path: binName, bundled: false }; // rely on PATH
}
