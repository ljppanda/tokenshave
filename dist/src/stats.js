import { mkdir, appendFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
export function statsDir() {
    return process.env.TOKENSHAVE_DIR ?? join(homedir(), ".tokenshave");
}
export async function record(entry) {
    const dir = statsDir();
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    await appendFile(join(dir, "stats.jsonl"), line, "utf8");
}
export function aggregate(entries, costPerMillion = 3) {
    const byTool = new Map();
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
function toolFingerprint(tool) {
    const first = tool.trim().split(/\s+/)[0] ?? tool;
    // strip common prefixes so "npx vitest" and "vitest" group together
    const cleaned = first.replace(/^\.?[\\/]/, "");
    return cleaned.length <= 20 ? cleaned : cleaned.slice(0, 20) + "…";
}
export async function loadStats() {
    const file = join(statsDir(), "stats.jsonl");
    let text;
    try {
        text = await readFile(file, "utf8");
    }
    catch {
        return [];
    }
    const out = [];
    for (const line of text.split("\n")) {
        if (!line.trim())
            continue;
        try {
            out.push(JSON.parse(line));
        }
        catch {
            // tolerate a torn write at process-kill time: skip that line
        }
    }
    return out;
}
