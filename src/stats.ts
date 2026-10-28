import { mkdir, appendFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

export function statsDir(): string {
  return process.env.TOKENSHAVE_DIR ?? join(homedir(), ".tokenshave");
}

export async function record(entry: Omit<StatEntry, "ts">): Promise<void> {
  const dir = statsDir();
  await mkdir(dir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  await appendFile(join(dir, "stats.jsonl"), line, "utf8");
}

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

export function aggregate(
  entries: Array<Omit<StatEntry, "ts"> & { ts?: string }>,
  costPerMillion = 3,
): Aggregate {
  const byTool = new Map<string, ToolStats>();
  let rawTokens = 0;
  let keptTokens = 0;

  for (const e of entries) {
    rawTokens += e.rawTokens;
    keptTokens += e.keptTokens;
    const key = toolFingerprint(e.tool);
    const cur = byTool.get(key) ?? { tool: key, calls: 0, rawTokens: 0, keptTokens: 0 };
    cur.calls += 1;
    cur.rawTokens += e.rawTokens;
    cur.keptTokens += e.keptTokens;
    byTool.set(key, cur);
  }

  const savedCost = ((rawTokens - keptTokens) / 1_000_000) * costPerMillion;
  return {
    entries: entries.length,
    rawTokens,
    keptTokens,
    costPerMillion,
    savedCost,
    byTool: [...byTool.values()].sort((a, b) => b.rawTokens - a.rawTokens),
  };
}

/** Collapse a tool command to a stable family name: "npm install express" → "npm". */
function toolFingerprint(tool: string): string {
  const first = tool.trim().split(/\s+/)[0] ?? tool;
  // strip common prefixes so "npx vitest" and "vitest" group together
  const cleaned = first.replace(/^\.?[\\/]/, "");
  return cleaned.length <= 20 ? cleaned : cleaned.slice(0, 20) + "…";
}

export async function loadStats(): Promise<StatEntry[]> {
  const file = join(statsDir(), "stats.jsonl");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const out: StatEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as StatEntry);
    } catch {
      // tolerate a torn write at process-kill time: skip that line
    }
  }
  return out;
}
