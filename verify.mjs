/**
 * Real-output verification. Reads captured command outputs and measures
 * raw vs shaved token counts with a real BPE tokenizer (GPT o200k),
 * not our chars/4 estimate.
 */
import { readFileSync } from "node:fs";
import { encode } from "gpt-tokenizer";
import { shave } from "./dist/src/index.js";
import { join } from "node:path";

const dir = process.env.TEMP ?? "C:\\Windows\\Temp";

const cases = [
  { file: join(dir, "ts-verify", "out-diff-scattered.txt"), tool: "git diff" },
  { file: join(dir, "ts-verify", "out-eresolve.txt"), tool: "npm install @testing-library/react@16" },
  { file: join(dir, "ts-verify-out-early.txt"), tool: "node --test" },
];

console.log("case              raw tok  shaved tok   saved   kept/error lines");
for (const c of cases) {
  const raw = readFileSync(c.file, "utf8");
  const r = shave(c.tool, raw);
  const rawTok = encode(raw).length;
  const keptTok = encode(r.output).length;
  const saved = ((rawTok - keptTok) / rawTok * 100).toFixed(0) + "%";
  console.log(
    `${c.file.padEnd(18)}${String(rawTok).padStart(7)}  ${String(keptTok).padStart(10)}  ${saved.padStart(6)}   ${r.keptLines}/${r.rawLines} (${r.rule})`,
  );
}

// chars/4 estimate vs real BPE, for the record
const raw = readFileSync(cases[0].file, "utf8");
console.log(`\nestimation check: chars/4 = ${Math.ceil(raw.length / 4)}, real BPE o200k = ${encode(raw).length}`);
