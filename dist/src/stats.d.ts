/**
 * Stats live in a plain JSONL file the user owns:
 *   $TOKENSHAVE_DIR/stats.jsonl  (default ~/.tokenshave/stats.jsonl)
 */
export interface StatEntry {
    /** ISO timestamp */
    ts: string;
    /** tool command, e.g. "npm install express" */
    tool: string;
    rule: string;
    rawLines: number;
    keptLines: number;
    rawTokens: number;
    keptTokens: number;
}
export declare function statsDir(): string;
export declare function record(entry: Omit<StatEntry, "ts">): Promise<void>;
export interface ToolStats {
    tool: string;
    calls: number;
    rawTokens: number;
    keptTokens: number;
}
export interface Aggregate {
    entries: number;
    rawTokens: number;
    keptTokens: number;
    /** default USD price per 1M input tokens, e.g. 3 */
    costPerMillion: number;
    /** ≈ USD saved, back-of-napkin */
    savedCost: number;
    byTool: ToolStats[];
}
export declare function aggregate(entries: Array<Omit<StatEntry, "ts"> & {
    ts?: string;
}>, costPerMillion?: number): Aggregate;
export declare function loadStats(): Promise<StatEntry[]>;
