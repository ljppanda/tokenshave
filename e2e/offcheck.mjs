import { readFileSync } from "node:fs";
import { shave } from "../dist/src/index.js";

// ERESOLVE dump: every line is an error -> must be byte-identical (0% saved)
const raw = readFileSync(new URL("./out-erresolve.txt", import.meta.url), "utf8");
const r = shave("npm install", raw);
const identical = r.output === raw;
console.log(`preserves real ERESOLVE byte-identical: ${identical ? "YES" : "NO — FAIL"}  (${r.rule}, ${r.rawLines} lines, saved ${Math.round((1 - r.keptTokens / r.rawTokens) * 100)}%)`);

// error dump longer than budget must also survive
const longError = Array.from({ length: 60 }, (_, i) => `npm error line ${i}: ERESOLVE unable to resolve dependency tree`).join("\n");
const r2 = shave("npm install", longError);
console.log(`60 synthetic error lines: saved=${Math.round((1 - r2.keptTokens / r2.rawTokens) * 100)}% rule=${r2.rule} identical=${r2.output === longError ? "YES" : "NO — FAIL"}`);

// test-runner regression: failing names survive
const tap = readFileSync(new URL("./out-s2.txt", import.meta.url), "utf8");
const r3 = shave("node --test test/math.test.cjs", tap);
console.log(`TAP failing names kept: ${(r3.output.match(/not ok/g) ?? []).length} lines, name present=${r3.output.includes("div fails on purpose")}`);

// generic marker-flood regression
const secret = readFileSync(new URL("./out-secret.txt", import.meta.url), "utf8");
const r4 = shave("node secret.js", secret);
const head = (r4.output.match(/tokenshave: removed/g) ?? []).length;
const gaps = (r4.output.match(/\(\u2033? \u2026 \+\d+ trimmed\)/g) ?? []).length;
console.log(`secret.js: saved=${Math.round((1 - r4.keptTokens / r4.rawTokens) * 100)}% head-notes=${head} short-gaps=${gaps}`);
