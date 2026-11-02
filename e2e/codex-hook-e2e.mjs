#!/usr/bin/env node
// Codex hook acceptance harness, run entirely without an OpenAI account:
//  1. installs the project-local hook (hooks.json + shave.js) into a scratch
//     project, exactly like `npx tokenshave install` does
//  2. feeds the hook the exact stdin JSON contract of Codex 0.166.0
//     (PostToolUse / Bash / tool_response as string) for a large synthetic
//     npm test output and asserts the replacement envelope
//  3. asserts pass-through (small output) and fail-open (garbage stdin)
//
// A real interactive Codex session additionally requires OpenAI credentials;
// that session-level verdict is honestly documented as pending (VERIFY.md).
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { installPlugins, codexTargets } from "../dist/src/install.js";

let failures = 0;
function check(name, ok, detail = "") {
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok || !detail ? "" : " — " + detail));
  if (!ok) failures++;
}

const dir = await mkdtemp(join(tmpdir(), "tokenshave-codex-e2e-"));
const url = pathToFileURL(join(process.cwd(), "dist", "src", "index.js")).href;
const reports = await installPlugins(dir, url);
const codex = codexTargets(dir);
for (const r of reports.filter((x) => x.agent === "codex"))
  check("install wrote " + r.file, r.action === "created");
const hooksConfig = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(codex.hooksJson, "utf8")));
check("hooks.json command points at the generated script",
  hooksConfig.hooks.PostToolUse[0].hooks[0].command.includes(codex.shaveJs.replace(/\\/g, "/")));

const BIG =
  Array.from({ length: 220 }, (_, i) => `ok ${i} - synthetic passing case`).join("\n") +
  "\nnot ok 42 - test/e2e-failure.js\nreal error line";
const CMD = "npm test -- --silent";

function runHook(stdin) {
  const r = spawnSync(process.execPath, [codex.shaveJs], { input: stdin, encoding: "utf8" });
  return { stdout: (r.stdout ?? "").trim(), status: r.status };
}

const env = JSON.stringify({
  hook_event_name: "PostToolUse",
  tool_name: "Bash",
  tool_input: { command: CMD },
  tool_response: BIG,
});
const { stdout, status } = runHook(env);
let shaved = null;
try {
  shaved = JSON.parse(stdout);
} catch {}
check("big output → replacement envelope (continue:false)", status === 0 && shaved?.continue === false);
check("failure line kept byte-identical", shaved?.reason?.includes("not ok 42 - test/e2e-failure.js") === true);
check("marker line present", shaved?.reason?.startsWith("␥ (tokenshave: removed") === true);
const rawBytes = BIG.length, keptBytes = shaved?.reason?.length ?? 0;
check(`size reduced (${rawBytes} → ${keptBytes} bytes, ${Math.round((1 - keptBytes / rawBytes) * 100)}%)`, keptBytes > 0 && keptBytes < rawBytes);
check("stopReason summary", /trimmed \d+ of \d+ lines/.test(shaved?.stopReason ?? ""));

const small = runHook(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: CMD }, tool_response: "small" }));
check("small output → pass-through (empty stdout, exit 0)", small.status === 0 && small.stdout === "");

const garbage = runHook("definitely not json");
check("garbage stdin → fail open (empty stdout, exit 0)", garbage.status === 0 && garbage.stdout === "");

const wrongTool = runHook(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "ReadFile", tool_input: { path: "x" }, tool_response: BIG }));
check("non-Bash tool → pass-through", wrongTool.status === 0 && wrongTool.stdout === "");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nall codex-hook checks passed (harness-level; live-session verdict pending an OpenAI key)");
}
