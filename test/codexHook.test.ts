import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { generateCodexHookFiles, CODEX_HOOK_MARKER } from "../src/codexHook.js";
import { shave as engineShave } from "../src/engine/trim.js";

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tokenshave-codex-test-"));
}

/** write the generated hook and run it as Codex would: JSON on stdin */
function runHook(scriptPath: string, stdin: string): { stdout: string; status: number } {
  const r = spawnSync(process.execPath, [scriptPath], {
    input: stdin,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { stdout: r.stdout ?? "", status: r.status === null ? -1 : r.status };
}

const BIG_OUTPUT =
  Array.from({ length: 220 }, (_, i) => `ok ${i} - synthetic passing case`).join("\n") +
  "\nnot ok 42 - test/e2e-failure.js\nreal error line";
const CMD = "npm test -- --silent";

async function writeHook(dir: string): Promise<{ path: string }> {
  const files = await generateCodexHookFiles("test", "0.0.0", 'node "hook.js"');
  const path = join(dir, "shave.js");
  await writeFile(path, files.shaveJs, "utf8");
  return { path };
}

function codexStdin(output: string, toolName = "Bash"): string {
  return JSON.stringify({
    session_id: "test-session",
    cwd: "C:/proj",
    hook_event_name: "PostToolUse",
    model: "test-model",
    permission_mode: "default",
    tool_name: toolName,
    tool_use_id: "call-1",
    tool_input: { command: CMD },
    tool_response: output,
  });
}

test("hook: replaces a big shell result with the shaved JSON envelope", async () => {
  const dir = await scratch();
  try {
    const { path } = await writeHook(dir);
    const { stdout, status } = runHook(path, codexStdin(BIG_OUTPUT));
    assert.equal(status, 0, "hook always exits 0");
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.continue, false);
    assert.equal(parsed.stopReason.includes("tokenshave"), true);
    assert.match(parsed.stopReason, /trimmed \d+ of \d+/);
    assert.equal(parsed.reason, engineShave(CMD, BIG_OUTPUT).output, "byte-identical to the real engine");
    assert.ok(parsed.reason.includes("not ok 42"), "failure line kept");
    assert.ok(!("suppressOutput" in parsed), "no unsupported fields");
    assert.ok(!("decision" in parsed), "no decision field — replacement, not error");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("hook: small or unchanged output passes through untouched (empty stdout)", async () => {
  const dir = await scratch();
  try {
    const { path } = await writeHook(dir);
    const small = runHook(path, codexStdin("tiny output"));
    assert.equal(small.status, 0);
    assert.equal(small.stdout, "");
    const pass = runHook(path, codexStdin(BIG_OUTPUT.slice(0, 49)));
    assert.equal(pass.status, 0);
    assert.equal(pass.stdout, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("hook: wrong event/tool, non-string tool_response, garbage stdin → fail open", async () => {
  const dir = await scratch();
  try {
    const { path } = await writeHook(dir);
    for (const stdin of [
      codexStdin(BIG_OUTPUT, "apply_patch"),
      JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: CMD },
        tool_response: { nested: "object" },
      }),
      "not json at all",
      "",
    ]) {
      const r = runHook(path, stdin);
      assert.equal(r.status, 0);
      assert.equal(r.stdout, "");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("hook: project-local hooks.json points at the generated script by absolute path", async () => {
  const dir = await scratch();
  try {
    const script = join(dir, ".tokenshave", "tokenshave-shave.js").replace(/\\/g, "/");
    const files = await generateCodexHookFiles(
      "test",
      "0.0.0",
      `node "${script}"`,
    );
    const hooks = JSON.parse(files.hooksJson);
    const entry = hooks.hooks.PostToolUse[0];
    assert.equal(entry.matcher, "Bash");
    assert.equal(entry.hooks[0].type, "command");
    assert.ok(entry.hooks[0].command.includes("tokenshave-shave.js"), "absolute script path");
    assert.equal(typeof entry.hooks[0].timeout, "number");
    assert.ok(files.shaveJs.includes(CODEX_HOOK_MARKER));
    assert.ok(!/^\s*import /m.test(files.shaveJs), "no imports");
    assert.match(files.pluginJson!, /"name": "tokenshave"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
