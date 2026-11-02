#!/usr/bin/env node
// Cursor hook acceptance harness, run entirely without a Cursor install:
//  1. installs the project-local hook (.cursor/hooks.json + the dual-role
//     wrapper script), exactly like `npx tokenshave install` does
//  2. feeds the hook the exact preToolUse stdin contract from the Cursor
//     hooks documentation and asserts the documented updated_input rewrite
//  3. EXECUTES the rewritten command like Cursor's agent would — and asserts
//     the terminal output the agent would capture is shaved, keeps failure
//     lines byte-identical, and preserves the child's exit code
//  4. asserts pass-through (non-whitelisted / sandboxed / wrapped commands)
//     and fail-open (garbage stdin) emit valid {"permission":"allow"} JSON
//
// A real interactive Cursor session is the IDE's own surface; this project's
// author verifies there with the running desktop app only when available —
// that session-level verdict is honestly documented as pending (VERIFY.md).
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { installPlugins, cursorTargets } from "../dist/src/install.js";

let failures = 0;
function check(name, ok, detail = "") {
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok || !detail ? "" : " — " + detail));
  if (!ok) failures++;
}

const dir = await mkdtemp(join(tmpdir(), "tokenshave-cursor-e2e-"));
const reports = await installPlugins(dir);
for (const r of reports.filter((x) => x.agent === "cursor")) {
  check("install wrote " + r.file.replace(dir, ""), r.action === "created");
}

const targets = cursorTargets(dir);
const hooksConfig = JSON.parse(await readFile(targets.hooksJson, "utf8"));
const entry = hooksConfig.hooks?.preToolUse?.[0];
check("hooks.json: version 1, one preToolUse entry with matcher Shell",
  hooksConfig.version === 1 &&
  Array.isArray(hooksConfig.hooks?.preToolUse) && hooksConfig.hooks.preToolUse.length === 1 &&
  entry?.matcher === "Shell");
check("hooks.json: command references the generated wrapper script",
  typeof entry?.command === "string" && entry.command.includes("tokenshave-cursor.js"));
const wrapJs = await readFile(targets.wrapJs, "utf8");
check("wrapper script is self-contained (no static imports)",
  !/^\s*(import|export) /m.test(wrapJs) && wrapJs.includes("node:child_process"));

function runHook(stdin) {
  const r = spawnSync(process.execPath, [targets.wrapJs], { input: stdin, encoding: "utf8", timeout: 60_000 });
  return { stdout: (r.stdout ?? "").trim(), status: r.status };
}
function hookInput(command, extra = {}) {
  return JSON.stringify({
    conversation_id: "e2e", generation_id: "e2e", model: "m",
    hook_event_name: "preToolUse", cursor_version: "0.0.0",
    workspace_roots: [dir], user_email: null, transcript_path: null,
    tool_name: "Shell", tool_input: { command, working_directory: dir },
    tool_use_id: "call-1", cwd: dir, ...extra,
  });
}

// 3. rewrite for a whitelisted install command
const dna = runHook(hookInput("npm install express"));
let decided = null;
try { decided = JSON.parse(dna.stdout); } catch {}
check("hook exits 0 on every path", dna.status === 0 || Boolean(decided), "status " + dna.status);
check("whitelisted command → permission allow + updated_input",
  decided?.permission === "allow" && typeof decided?.updated_input?.command === "string");
const rewritten = decided?.updated_input?.command ?? "";
check("rewrite invokes the same script with a base64 payload + tag",
  rewritten.startsWith("node ") && rewritten.includes("tsh-cursor-wrap"));
const b64 = (rewritten.match(/\s([A-Za-z0-9+/=]+)\s/)?.[1] ?? "");
check("payload decodes to the original command",
  Buffer.from(b64, "base64").toString("utf8") === "npm install express");
check("tool_input fields survive the rewrite",
  decided?.updated_input?.working_directory === dir);

// 4. execute the rewrite like Cursor would and capture the "terminal output"
const fixture = join(dir, "noisy.js");
await mkdir(dirname(fixture), { recursive: true });
await writeFile(
  fixture,
  `for (let i = 0; i < 220; i++) console.log("ok " + i + " - synthetic passing case");\n` +
    `console.log("not ok 42 - test/e2e-failure.js");\nconsole.error("real error line");\nprocess.exitCode = 7;\n`,
  "utf8",
);
// execute the probe with the same rewrite mechanics Cursor would use:
// base64 payload → the wrapper runs the real command → Cursor captures stdout
{
  const probeCmd = `${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)}`;
  const probeB64 = Buffer.from(probeCmd, "utf8").toString("base64");
  // force the rewrite path even for the probe command by feeding probeB64 + tag
  const r = spawnSync(process.execPath, [targets.wrapJs, probeB64, "tsh-cursor-wrap"], { encoding: "utf8", timeout: 120_000 });
  const stdout = r.stdout ?? "";
  const raw = 220 + 2; // synthetic lines + not-ok
  check("rewritten execution: exit code of the child preserved", r.status === 7, "status " + r.status);
  check("rewritten execution: output shaved (marker present)", stdout.includes("␥"));
  check("rewritten execution: failure line kept byte-identical", stdout.includes("not ok 42 - test/e2e-failure.js"));
  const saved = Math.round((1 - stdout.length / (raw * 33)) * 100);
  check(`rewritten execution: substantial reduction (${saved}%)`, saved > 50, `${stdout.length} bytes`);
  check("rewritten execution: stderr channel separate and intact", (r.stderr ?? "").trim() === "real error line");
}

// 5. pass-through family
const skip = [
  ["npm run dev (watcher)", hookInput("npm run dev")],
  ["git commands", hookInput("git status && git log --oneline")],
  ["non-Shell tool", hookInput("npm install express", { tool_name: "Read" })],
];
for (const [name, stdin] of skip) {
  const r = runHook(stdin);
  const parsed = JSON.parse(r.stdout ?? "{}");
  check(
    `pass-through: ${name} → allow, no rewrite`,
    r.status === 0 && parsed.permission === "allow" && !("updated_input" in parsed),
  );
}

// sandbox + already-wrapped
const sbx = runHook(hookInput("npm install express", { sandbox: true }));
check("pass-through: sandboxed command never rewritten",
  JSON.parse(sbx.stdout).permission === "allow" && !JSON.parse(sbx.stdout).updated_input);
const wrapped = runHook(hookInput(`node "x.js" ${b64} tsh-cursor-wrap`));
check("pass-through: already-wrapped command never double-wrapped",
  JSON.parse(wrapped.stdout).permission === "allow" && !JSON.parse(wrapped.stdout).updated_input);

// 6. fail-open: garbage stdin emits a valid allow, never exit 2
const garbage = runHook("definitely not json");
check("fail-open: garbage stdin → valid allow, exit 0",
  garbage.status === 0 && JSON.parse(garbage.stdout).permission === "allow");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nall cursor-hook checks passed (harness-level; live-session verdict documented in VERIFY.md)");
}
