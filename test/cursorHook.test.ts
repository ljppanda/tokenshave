import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { generateCursorHookFiles, CURSOR_HOOK_MARKER } from "../src/cursorHook.js";
import { shave as engineShave } from "../src/engine/trim.js";
async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tokenshave-cursor-test-"));
}
const TAG = "tsh-cursor-wrap";
/** run the generated script in hook mode: spawn a real process, JSON on stdin */
function runHook(scriptPath: string, stdin: string): { stdout: string; status: number } {
  const r = spawnSync(process.execPath, [scriptPath], {
    input: stdin,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { stdout: r.stdout ?? "", status: r.status === null ? -1 : r.status };
}
/** run the script in wrapper mode against a real command; returns the child's streams */
function runWrapper(
  wrapPath: string,
  cmd: string,
): { stdout: string; stderr: string; status: number } {
  const b64 = Buffer.from(cmd, "utf8").toString("base64");
  const r = spawnSync(process.execPath, [wrapPath, b64, TAG], {
    encoding: "utf8",
    timeout: 60_000,
  });
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    status: r.status === null ? -1 : r.status,
  };
}
async function writeHook(dir: string): Promise<{ hooksPath: string; wrapPath: string }> {
  const files = await generateCursorHookFiles("test", "0.0.0", 'node "hook.js"');
  const hooksPath = join(dir, ".cursor", "hooks.json");
  const wrapPath = join(dir, ".tokenshave", "tokenshave-cursor.js");
  await mkdir(dirname(hooksPath), { recursive: true });
  await mkdir(dirname(wrapPath), { recursive: true });
  await writeFile(hooksPath, files.hooksJson, "utf8");
  await writeFile(wrapPath, files.wrapJs, "utf8");
  return { hooksPath, wrapPath };
}
function cursorStdin(command: string, toolName = "Shell", extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    conversation_id: "test-conv",
    generation_id: "test-gen",
    model: "test-model",
    hook_event_name: "preToolUse",
    cursor_version: "1.7.2",
    workspace_roots: ["C:/proj"],
    user_email: null,
    transcript_path: null,
    tool_name: toolName,
    tool_input: { command, working_directory: "C:/proj/src" },
    tool_use_id: "call-1",
    cwd: "C:/proj",
    ...extra,
  });
}
test("hook: rewrites a whitelisted command into the inline wrapper (updated_input)", async () => {
  const dir = await scratch();
  try {
    const { wrapPath } = await writeHook(dir);
    const { stdout, status } = runHook(wrapPath, cursorStdin("npm install express"));
    assert.equal(status, 0, "hook always exits 0");
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.permission, "allow");
    const cmd = parsed.updated_input?.command as string;
    assert.ok(cmd.startsWith("node "), "rewrite invokes node");
    assert.ok(cmd.includes(TAG), "wrapper tag present");
    const m = cmd.match(/node\s+("[^"]+"|\S+)\s+(\S+)/);
    assert.ok(m, "rewrite shape: node <path> <b64> <tag>");
    const b64 = m![2];
    assert.equal(Buffer.from(b64, "base64").toString("utf8"), "npm install express");
    // other tool_input fields survive the rewrite
    assert.ok("working_directory" in parsed.updated_input);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("hook: exact pass-through allow for everything outside the whitelist", async () => {
  const dir = await scratch();
  try {
    const { wrapPath } = await writeHook(dir);
    const stdins = [
      cursorStdin("npm run dev"), // watchers: never touched
      cursorStdin("git status && git log --oneline"),
      cursorStdin("npm install express", "Read"), // non-Shell tool
      "not json at all",
      "",
      JSON.stringify({ hook_event_name: "preToolUse", tool_name: "Shell", tool_input: { command: "" } }),
    ];
    for (let i = 0; i < stdins.length; i++) {
      const r = runHook(wrapPath, stdins[i]);
      assert.equal(r.status, 0, `case ${i} exits 0`);
      const parsed = JSON.parse(r.stdout);
      assert.equal(parsed.permission, "allow", `case ${i} is a valid allow (fail-open shape)`);
      if (i <= 2) assert.ok(!("updated_input" in parsed), `case ${i} does not rewrite`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("hook: sandbox commands and already-wrapped commands are never rewritten", async () => {
  const dir = await scratch();
  try {
    const { wrapPath } = await writeHook(dir);
    const sandboxed = runHook(
      wrapPath,
      cursorStdin("npm install express", "Shell", { sandbox: true }),
    );
    const sp = JSON.parse(sandboxed.stdout);
    assert.equal(sp.permission, "allow");
    assert.ok(!("updated_input" in sp), "sandbox command untouched");
    const already = runHook(wrapPath, cursorStdin(`node "x.js" aGVsbG8= ${TAG}`));
    const ap = JSON.parse(already.stdout);
    assert.equal(ap.permission, "allow");
    assert.ok(!("updated_input" in ap), "already-wrapped command untouched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("wrapper: big command output is shaved, failure lines kept, exit code preserved", async () => {
  const dir = await scratch();
  try {
    const { wrapPath } = await writeHook(dir);
    const fixture = join(dir, "noisy.js");
    await writeFile(
      fixture,
      `for (let i = 0; i < 220; i++) console.log("ok " + i + " - synthetic passing case");\n` +
        `console.log("not ok 42 - test/e2e-failure.js");\nconsole.error("real error line");\n` +
        `process.exitCode = 7;\n`,
      "utf8",
    );
    const cmd = `${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)}`;
    const r = runWrapper(wrapPath, cmd);
    // wrapper's shave is the real engine: byte-compare against a live shave of
    // the same synthetic output (stdout only carried the two stdout lines)
    const stdoutMix =
      Array.from({ length: 220 }, (_, i) => `ok ${i} - synthetic passing case`).join("\n") +
      "\nnot ok 42 - test/e2e-failure.js\n";
    assert.equal(r.stdout, engineShave(cmd, stdoutMix).output, "engine-identical shaved stdout");
    assert.ok(r.stdout.includes("not ok 42"), "failure line kept");
    assert.ok(r.stdout.length < stdoutMix.length, "strictly smaller than raw");
    assert.ok(r.stdout.includes("␥"), "marker line present");
    assert.equal(r.stderr.trim(), "real error line", "stderr channel preserved separately");
    assert.equal(r.status, 7, "child exit code survives the wrapper");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("wrapper: small output stays byte-identical and rules match by command", async () => {
  const dir = await scratch();
  try {
    const { wrapPath } = await writeHook(dir);
    const fixture = join(dir, "small.js");
    await writeFile(fixture, `console.log("tiny output\\nsecond line");\n`, "utf8");
    const cmd = `${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)}`;
    const r = runWrapper(wrapPath, cmd);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "tiny output\nsecond line\n", "byte-identical for small outputs");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("generated files: cursor hooks.json schema + self-contained script", async () => {
  const dir = await scratch();
  try {
    const script = join(dir, ".tokenshave", "tokenshave-cursor.js").replace(/\\/g, "/");
    const files = await generateCursorHookFiles("test", "0.0.0", `node "${script}"`);
    // identity: the hooks.json references the generated script by path
    // (no extra schema fields — Cursor's hooks schema is strict)
    assert.ok(files.hooksJson.includes("tokenshave-cursor.js"));
    const hooks = JSON.parse(files.hooksJson);
    assert.equal(hooks.version, 1);
    const entry = hooks.hooks.preToolUse[0];
    assert.equal(entry.matcher, "Shell");
    assert.ok(entry.command.includes("tokenshave-cursor.js"), "absolute script path");
    assert.equal(typeof entry.timeout, "number");
    // dual-role generator sanity: both roles present in one file
    assert.ok(files.wrapJs.includes("#!/") === false, "no shebang (runs via node invocation)");
    assert.ok(files.wrapJs.includes(CURSOR_HOOK_MARKER));
    assert.ok(!/^\s*(import|export) /m.test(files.wrapJs), "no imports/exports (CJS+ESM dual-safe)");
    assert.ok(files.wrapJs.includes("node:child_process"), "dynamic import in wrapper mode");
    // engine sanity: shave is reachable in the generated source
    assert.ok(files.wrapJs.includes("function shave"), "engine inlined");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
