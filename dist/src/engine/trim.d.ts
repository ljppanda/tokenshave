export interface ShaveResult {
    /** Text to hand back to the agent. Identical to input when nothing was shaved. */
    output: string;
    /** Rule applied (or "diff", or "none"). */
    rule: string;
    rawLines: number;
    keptLines: number;
    rawTokens: number;
    keptTokens: number;
}
/**
 * The one public entry point.
 *
 * @param tool   The command that produced the output, e.g. "npm install express"
 *               or "vitest run". Used to pick a shaving rule.
 * @param output Raw tool output.
 */
export declare function shave(tool: string, output: string): ShaveResult;
/** Collapse runs of ≥ RUN_MIN consecutive identical lines to 2 + a marker. */
export declare function dedupeRuns(lines: string[]): {
    lines: string[];
    total: number;
    removed: number;
    runCount: number;
};
