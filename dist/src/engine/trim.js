import { estimateTokens } from "./tokens.js";
import { ruleFor } from "./rules.js";
import { shaveDiff } from "./diff.js";
const HEAD_NOTE = "␥ (tokenshave: removed %d of %d lines; head, tail and errors kept below)";
function gapMarker(removed, total) {
    void total;
    return `␥ (… +${removed} trimmed)`;
}
function looksLikeDiff(output) {
    let hits = 0;
    for (const line of output.split("\n").slice(0, 200)) {
        if (line.startsWith("diff --git ") || line.startsWith("@@ -"))
            hits++;
        if (hits >= 2)
            return true;
    }
    return false;
}
/**
 * The one public entry point.
 *
 * @param tool   The command that produced the output, e.g. "npm install express"
 *               or "vitest run". Used to pick a shaving rule.
 * @param output Raw tool output.
 */
export function shave(tool, output) {
    const rawTokens = estimateTokens(output);
    const lines = output.split("\n");
    const rawLines = lines.length;
    if (looksLikeDiff(output)) {
        const { output: shaved, removed } = shaveDiff(output);
        const keptLines = rawLines - removed;
        return finalize(shaved, "diff", rawLines, keptLines, rawTokens);
    }
    const rule = ruleFor(tool);
    if (rawLines <= rule.budget) {
        return finalize(output, "none", rawLines, rawLines, rawTokens);
    }
    // First: collapse runs of consecutive identical lines (builders and CI
    // love to repeat the same warning 100x). Identical ≠ errors: repeated
    // warnings are pure noise.
    const deduped = dedupeRuns(lines);
    const { kept, removed, meaningful } = trimToBudget(rule, deduped.lines);
    const shaving = meaningful || deduped.removed > 0;
    const finalOutput = shaving ? kept.join("\n") : output;
    const finalKeptLines = shaving ? kept.length : rawLines;
    return finalize(finalOutput, shaving ? rule.name : "none", rawLines, finalKeptLines, rawTokens);
}
const RUN_MIN = 4;
/** Collapse runs of ≥ RUN_MIN consecutive identical lines to 2 + a marker. */
export function dedupeRuns(lines) {
    const out = [];
    let removed = 0;
    let runCount = 0;
    for (let i = 0; i < lines.length;) {
        let j = i + 1;
        while (j < lines.length && lines[j] === lines[i])
            j++;
        const run = j - i;
        if (run >= RUN_MIN && lines[i].trim() !== "") {
            // keep the first two, note the collapse
            out.push(lines[i], lines[i + 1]);
            out.push(`␥ ... (tokenshave: ${run - 2} identical lines collapsed)`);
            removed += run - 2;
            runCount++;
            i = j;
            continue;
        }
        for (let k = i; k < j; k++)
            out.push(lines[k]);
        i = j;
    }
    return { lines: out, total: out.length, removed, runCount };
}
/**
 * Keep head + tail + keep-matches, then hard-cap the kept list at the rule
 * budget by dropping middle matches first. Pure function.
 */
function trimToBudget(rule, lines) {
    const total = lines.length;
    const keepSet = new Set();
    for (let i = 0; i < Math.min(rule.head, total); i++)
        keepSet.add(i);
    for (let i = Math.max(rule.head, total - rule.tail); i < total; i++)
        keepSet.add(i);
    if (rule.keep) {
        for (let i = 0; i < total; i++) {
            if (rule.keep.test(lines[i]))
                keepSet.add(i);
        }
    }
    let kept = [...keepSet].sort((a, b) => a - b);
    if (kept.length === total) {
        // nothing was filtered out at this stage; hand back the (deduped) lines
        // untouched — a possible dedupe collapse is handled by the caller
        return { kept: lines, removed: 0, meaningful: false };
    }
    // if the only lines we'd drop are blank, shaving buys nothing —
    // return the original untouched so the output stays byte-identical
    const dropped = [];
    let p = -1;
    for (const i of kept) {
        for (let j = p + 1; j < i; j++)
            dropped.push(j);
        p = i;
    }
    const meaningful = dropped.some((i) => lines[i].trim() !== "");
    const trimmedTotal = dropped.length;
    const keptLines = [HEAD_NOTE.replace("%d", String(trimmedTotal)).replace("%d", String(total))];
    let prev = -2;
    for (const i of kept) {
        if (prev >= 0 && i !== prev + 1) {
            keptLines.push(gapMarker(i - prev - 1, total));
        }
        keptLines.push(lines[i]);
        prev = i;
    }
    return { kept: keptLines, removed: trimmedTotal, meaningful };
}
function finalize(output, rule, rawLines, keptLines, rawTokens) {
    const keptTokens = estimateTokens(output);
    return { output, rule, rawLines, keptLines, rawTokens, keptTokens };
}
