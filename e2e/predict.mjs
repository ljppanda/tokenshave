// offline prediction harness: run fixtures through the current build
import { readFileSync } from "node:fs";
import { shave } from "../dist/src/index.js";

const cases = [
  ["tsc --noEmit bad-many.ts bad.ts", "out-tsc.txt", "compiler"],
  ["git log -p -3", "out-gitlog.txt", "generic-or-diff"],
  ["npm install react --loglevel info", "out-npm-enzyme.txt", "package-manager (success dump w/ deprecation warns)"],
  ["npm install react --loglevel info", "out-npm-real.txt", "package-manager (cold-cache)"],
  ["npm install react --verbose", "out-npm-verbose.txt", "package-manager (verbose)"],
  ["curl -sS https://registry.npmjs.org/express", "out-curl.txt", "http-client"],
  ["node --test test/math.test.cjs", "out-s2.txt", "test-runner (regression: not ok kept)"],
  ["node secret.js", "out-secret.txt", "generic (regression: marker flood gone)"],
];

for (const [cmd, file, note] of cases) {
  let raw;
  try {
    raw = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
  } catch (e) {
    console.log(`${file}: MISSING (${String(e).slice(0, 60)})`);
    continue;
  }
  const r = shave(cmd, raw);
  const pct = Math.round((1 - r.keptTokens / r.rawTokens) * 100);
  const notOk = /not ok/.test(raw) ? `; "not ok" kept=${(r.output.match(/not ok/g) ?? []).length}` : "";
  console.log(`${file.padEnd(20)} ${String(r.rawLines).padStart(5)} -> ${String(r.keptLines).padStart(4)}  rule=${r.rule.padEnd(24)} saved=${String(pct).padStart(3)}%  ${note}${notOk}`);
}

