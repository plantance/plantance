import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { newBudget, type BudgetState } from "./budget.js";

export type RunState =
  | "INTAKE"
  | "PLAN"
  | "BUILD"
  | "VERIFY_LOCAL"
  | "FIX_BUILD"
  | "PROVISION"
  | "DEPLOY"
  | "FIX_DEPLOY"
  | "VERIFY_LIVE"
  | "DONE"
  | "FAIL_SOFT";

/** A UI-friendly log line. `kind` lets the UI style step vs raw vs error. */
export interface LogLine {
  ts: number;
  kind: "step" | "info" | "error" | "success";
  text: string;
}

export interface RunResult {
  url?: string;
  dbName?: string;
  account?: string;
  /** plain-language message on FAIL_SOFT (never a stack trace) */
  message?: string;
  /** path to the full technical log file, for the operator (spec §7) */
  techLogPath?: string;
}

/**
 * One Run = one build+deploy attempt, carrying state + logs (spec §5, §7).
 * Emits "log" and "state" events consumed by the SSE endpoint.
 */
export class Run extends EventEmitter {
  readonly id = randomUUID();
  state: RunState = "INTAKE";
  readonly log: LogLine[] = [];
  readonly budget: BudgetState = newBudget();
  result: RunResult = {};
  /** full technical transcript accumulated across all subprocesses */
  techLog = "";

  emitLog(kind: LogLine["kind"], text: string): void {
    const line: LogLine = { ts: Date.now(), kind, text };
    this.log.push(line);
    this.emit("log", line);
  }

  /** raw subprocess output — kept for the tech log file, not shown verbatim */
  appendTech(chunk: string): void {
    this.techLog += chunk + "\n";
  }

  setState(state: RunState): void {
    this.state = state;
    this.emit("state", state);
  }
}
