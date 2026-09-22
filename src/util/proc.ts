import { spawn } from "node:child_process";

export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** called for each complete line of stdout/stderr */
  onLine?: (line: string) => void;
  /** stdin to write, then close */
  input?: string;
}

export interface SpawnResult {
  code: number | null;
  /** full combined stdout+stderr transcript */
  log: string;
  timedOut: boolean;
}

/**
 * Subprocess helper with line-buffered streaming + hard timeout kill.
 * Reused by the Deployer (wrangler/npm) now and the Goose engine later (§6, §10).
 * Never throws on non-zero exit — the caller inspects `code`.
 */
export function spawnStreaming(
  command: string,
  args: string[],
  opts: SpawnOptions = {},
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let log = "";
    let timedOut = false;
    let stdoutBuf = "";
    let stderrBuf = "";

    const flush = (buf: string, isLast: boolean): string => {
      const parts = buf.split("\n");
      const rest = isLast ? "" : (parts.pop() ?? "");
      for (const line of parts) {
        log += line + "\n";
        opts.onLine?.(line);
      }
      return rest;
    };

    child.stdout.on("data", (d: Buffer) => {
      stdoutBuf = flush(stdoutBuf + d.toString(), false);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderrBuf = flush(stderrBuf + d.toString(), false);
    });

    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, opts.timeoutMs);
    }

    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      log += `[spawn error] ${err.message}\n`;
      opts.onLine?.(`[spawn error] ${err.message}`);
      resolve({ code: null, log, timedOut });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      flush(stdoutBuf, true);
      flush(stderrBuf, true);
      resolve({ code, log, timedOut });
    });
  });
}
