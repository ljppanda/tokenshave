#!/usr/bin/env node
// Generates a scratch project and installs both adapters into it, printing
// the mod that `claude plugin validate` / `claude plugin test` will run on.
import { mkdtemp, mkdir, copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { installPlugins, pluginTargets, } from "../dist/src/install.js";
import { claudeModTargets } from "../dist/src/claudeMod.js";

const dir = await mkdtemp(join(tmpdir(), "tokenshave-claude-e2e-"));
const url = pathToFileURL(join(process.cwd(), "dist", "src", "index.js")).href;
const reports = await installPlugins(dir, url);
console.log("project:", dir);
for (const r of reports) console.log(" ", r.agent, r.action, r.file);

// copy of the mod with an acceptance test attached for `claude plugin test`
const t = claudeModTargets(dir);
const testDir = join(dirname(t.pluginJson)); // <scratch>/.tokenshave/claude/mod
const modCopy = dir + "-modtest";
await mkdir(join(modCopy, "tests"), { recursive: true });
for (const rel of [
  [t.pluginJson, ".claude-plugin/plugin.json"],
  [t.hooksJson, "hooks/hooks.json"],
  [t.registerJs, "hooks/register.js"],
  [t.readme, "README.md"],
]) {
  await mkdir(dirname(join(modCopy, rel[1])), { recursive: true });
  await copyFile(rel[0], join(modCopy, rel[1]));
}

const bigOut = [
  "> repo@1.0.0 test",
  "> node --test test/",
  "",
  ...Array.from({ length: 220 }, (_, i) => `ok ${i} - synthetic passing case`),
  "",
  "not ok 42 - test/e2e-failure.js",
  "  ---",
  "    error: real failure for the agent to react to",
  "",
].join("\n");

await writeFile(
  join(modCopy, "tests", "shave.test.ts"),
  `import { expect, test } from "claude-code/testing"

test("bash stdout is shaved, failures kept", async ($, on) => {
  const big = ${JSON.stringify(bigOut)}
  // answer the tool call in Claude Code's place with realistic npm output
  on("tool.call", () => ({ result: { stdout: big, stderr: "", interrupted: false } }))
  const r = await $.tool.call({ tool: "Bash", command: "npm test --silent" })
  console.log("RESULT SHAPE:", JSON.stringify(r).slice(0, 300))
  const out = typeof r === "object" && r !== null && "stdout" in r ? r.stdout : r.result?.stdout
  expect(out.length).toBeLessThan(big.length)
  expect(out).toContain("not ok 42 - test/e2e-failure.js")
  expect(out).toContain("tokenshave")
})
`,
  "utf8",
);
console.log("mod copy for tests:", modCopy);
