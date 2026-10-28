import { test } from "node:test";
import assert from "node:assert/strict";
import { shave } from "../src/engine/trim.js";
import { ruleFor, ALWAYS_KEEP } from "../src/engine/rules.js";
import { estimateTokens } from "../src/engine/tokens.js";
import { aggregate } from "../src/stats.js";
function npmLikeOutput(lines, errorAt = -1) {
    const out = ["$ npm install express"];
    for (let i = 1; i < lines; i++) {
        if (i === errorAt) {
            out.push("npm ERR! code ERESOLVE");
            out.push("npm ERR! ERESOLVE unable to resolve dependency tree");
        }
        out.push(`added ${i} packages in ${i}ms`);
    }
    out.push("42 packages added in 3.2s");
    return out.join("\n");
}
test("npm install: big noisy output is shaved but errors and tail survive", () => {
    const raw = npmLikeOutput(300, 150);
    const r = shave("npm install express", raw);
    assert.ok(r.rawTokens > r.keptTokens, "should save tokens");
    assert.equal(r.rule, "package-manager-install");
    assert.ok(r.output.includes("ERESOLVE"), "error lines must survive");
    assert.ok(r.output.includes("$ npm install express"), "head survives");
    assert.ok(r.output.includes("42 packages added in 3.2s"), "tail summary survives");
    assert.ok(r.output.includes("(tokenshave: "), "marker must state what was removed");
    const outLines = r.output.split("\n");
    assert.ok(outLines.length < raw.split("\n").length / 2, "must cut at least half");
});
test("small output: untouched and rule is 'none'", () => {
    const raw = npmLikeOutput(5);
    const r = shave("npm install express", raw);
    assert.equal(r.output, raw);
    assert.equal(r.rule, "none");
    assert.equal(r.rawTokens, r.keptTokens);
});
test("test runner: vitest keeps failure lines and summary", () => {
    const lines = [">$ npx vitest run"];
    for (let i = 0; i < 120; i++)
        lines.push(` ✓ src/api.test.ts > case ${i}`);
    lines.push(" ✗ src/api.test.ts > saves-user > expected 200 got 500");
    lines.push("Test Files  2 failed | 118 passed");
    lines.push("     Tests  3 failed | 900 passed");
    const raw = lines.join("\n");
    const r = shave("npx vitest run", raw);
    assert.equal(r.rule, "test-runner");
    assert.ok(r.rawTokens > r.keptTokens);
    assert.ok(r.output.includes("expected 200 got 500"), "failure line survives");
    assert.ok(r.output.includes("Tests  3 failed"), "summary survives");
});
test("unified diff: context lines dropped, +/- kept, file headers kept", () => {
    const ing = "diff --git a/src/a.ts b/src/a.ts\nindex 111..222 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n";
    const lines = [ing];
    for (let i = 0; i < 30; i++)
        lines.push(` unchanged context line ${i}`);
    lines.push("@@ -1,3 +1,4 @@");
    lines.push("+const x = f(api: 'v2');");
    const raw = lines.join("\n");
    const r = shave("git diff", raw);
    assert.equal(r.rule, "diff");
    assert.ok(r.keptTokens < r.rawTokens, "must save tokens");
    assert.ok(r.output.includes("diff --git a/src/a.ts b/src/a.ts"), "file header survives");
    assert.ok(r.output.includes("+const x = f(api: 'v2');"), "added line survives");
    assert.ok(r.output.includes("@@ -1,3 +1,4 @@"), "hunk header survives");
    assert.ok(!r.output.includes(" unchanged context line 10"), "pure context dropped");
    assert.ok(r.output.includes("(tokenshave:"), "marker present");
});
test("diff with git stderr noise: noise collapses, diff survives", () => {
    const warn = "warning: in the working copy of 'src/a.ts', LF will be replaced by CRLF";
    const lines = [];
    for (let i = 0; i < 29; i++)
        lines.push(warn + i);
    lines.push("diff --git a/src/a.ts b/src/a.ts");
    lines.push("index 111..222 100644");
    lines.push("--- a/src/a.ts");
    lines.push("+++ b/src/a.ts");
    lines.push("@@ -1,3 +1,3 @@");
    lines.push(" const x = 1;");
    lines.push("-const y = 2;");
    lines.push("+const y = 3;");
    const r = shave("git diff", lines.join("\n"));
    assert.equal(r.rule, "diff");
    assert.ok(r.output.includes("diff --git a/src/a.ts b/src/a.ts"), "header survives");
    assert.ok(r.output.includes("+const y = 3;"), "added line survives");
    assert.ok(r.output.includes("-const y = 2;"), "removed line survives");
    assert.ok(r.output.includes(" const x = 1;") === false, "context dropped");
    assert.ok(r.output.includes(warn), "first noise lines kept as safety");
    assert.ok(r.keptTokens < r.rawTokens * 0.5, "noise-heavy diff should save hard");
});
test("diff without file header is treated as a normal tool output", () => {
    const raw = Array.from({ length: 30 }, (_, i) => ` line ${i}`).join("\n");
    const r = shave("git diff", raw);
    assert.notEqual(r.rule, "diff");
});
test("generic fallback handles the unknown haircuts too", () => {
    const raw = Array.from({ length: 200 }, (_, i) => `noise ${i}`).join("\n");
    const r = shave("some-unknown-tool --verbose", raw);
    assert.equal(r.rule, "generic");
    assert.ok(r.keptTokens < r.rawTokens);
    assert.ok(r.output.includes("noise 0"), "head survives");
    assert.ok(r.output.includes("noise 199"), "tail survives");
});
test("ALWAYS_KEEP covers real error spellings agents emit", () => {
    for (const line of [
        "Error: Cannot find module",
        "npm ERR! EACCES permission denied",
        "AssertionError: expected 200 to equal 500",
        "fatal: not a git repository",
        "not ok 3 - div fails on purpose", // TAP failing-test line must survive
    ]) {
        assert.ok(ALWAYS_KEEP.test(line), `must keep: ${line}`);
    }
});
test("ruleFor never returns undefined", () => {
    assert.ok(ruleFor("docker pull"));
    assert.ok(ruleFor(""));
});
test("aggregate sums stats by tool family and computes saved cost", () => {
    const agg = aggregate([
        { tool: "npm install a", rule: "package-manager-install", rawLines: 100, keptLines: 10, rawTokens: 1000, keptTokens: 100 },
        { tool: "npm install b", rule: "package-manager-install", rawLines: 50, keptLines: 10, rawTokens: 500, keptTokens: 100 },
        { tool: "git diff", rule: "diff", rawLines: 30, keptLines: 20, rawTokens: 3000, keptTokens: 2200 },
    ], 3);
    assert.equal(agg.entries, 3);
    assert.equal(agg.rawTokens, 4500);
    assert.equal(agg.keptTokens, 2400);
    assert.equal(agg.savedCost, ((4500 - 2400) / 1_000_000) * 3);
    assert.equal(agg.byTool.find((t) => t.tool === "npm").calls, 2); // two npm installs grouped
});
test("identical warning spam collapses but errors inside survive", () => {
    const warn = "warning: in the working copy of 'src/a.ts', LF will be replaced by CRLF";
    const lines = Array.from({ length: 100 }, () => warn);
    lines.splice(10, 0, "npm ERR! EACCES permission denied");
    const r = shave("some-unknown-tool --verbose", lines.join("\n"));
    assert.ok(r.output.includes("EACCES"), "single error must survive");
    assert.ok(r.output.includes("identical lines collapsed"), "run collapse marker");
    assert.ok(r.keptTokens < r.rawTokens * 0.5, "spam must collapse hard");
    assert.equal(r.rule, "generic");
});
test("all-error output with only-blank drops stays byte-identical", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `npm error ERESOLVE line ${i}`);
    lines.push(""); // only blank line would be dropped
    const raw = lines.join("\n");
    const r = shave("npm install @testing-library/react@16", raw);
    assert.equal(r.output, raw, "must stay byte-identical");
    assert.equal(r.rawTokens, r.keptTokens);
});
test("estimateTokens is roughly chars/4 and never zero for nonempty text", () => {
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens(""), 0);
    assert.ok(estimateTokens("a".repeat(400)) === 100);
});
