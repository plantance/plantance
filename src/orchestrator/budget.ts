/**
 * Budget / safety caps (spec §7). BYOK = the user's money. Every state
 * transition checks these first. A runaway loop is the fastest uninstall.
 */
export const CAPS = {
  maxBuildFixAttempts: 3, // N
  maxDeployFixAttempts: 2, // M
  maxTotalAgentRuns: 8, // hard ceiling on any single Run
  maxWallClockMs: 15 * 60_000, // 15 min per Run
  maxEstimatedTokens: 2_000_000, // abort + warn past this
} as const;

export interface BudgetState {
  agentRuns: number;
  startedAt: number;
  estimatedTokens: number;
}

export function newBudget(): BudgetState {
  return { agentRuns: 0, startedAt: Date.now(), estimatedTokens: 0 };
}

/** Returns a reason string if any cap is blown, else null. */
export function checkBudget(b: BudgetState): string | null {
  if (b.agentRuns > CAPS.maxTotalAgentRuns) {
    return `Reached the limit of ${CAPS.maxTotalAgentRuns} build attempts.`;
  }
  if (Date.now() - b.startedAt > CAPS.maxWallClockMs) {
    return `This took longer than ${CAPS.maxWallClockMs / 60_000} minutes and was stopped.`;
  }
  if (b.estimatedTokens > CAPS.maxEstimatedTokens) {
    return `This would use more of your AI credits than expected and was stopped.`;
  }
  return null;
}
