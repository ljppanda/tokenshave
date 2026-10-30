#!/usr/bin/env node
// Regenerates the repo's claude-mod/ directory from the compiled engine.
// The output is committed, and CI re-runs this script and fails on any
// content drift (git diff --exit-code), so the in-repo mod can never go
// stale relative to src/.
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngineBundle } from "../dist/src/claudeBundle.js";
import { generateClaudeModFiles } from "../dist/src/claudeMod.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "claude-mod");

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

const engine = await loadEngineBundle();
const generatedAt = "repo build — regenerate with `npm run gen:claude-mod`";
const files = generateClaudeModFiles(generatedAt, engine, pkg.version);
const PATHS = {
  hooksJson: "hooks/hooks.json",
  pluginJson: ".claude-plugin/plugin.json",
  registerJs: "hooks/register.js",
  readme: "README.md",
};

await rm(outDir, { recursive: true, force: true });
for (const { target, content } of files) {
  if (target === "marketplaceJson") continue; // project-local only
  if (!(target in PATHS)) throw new Error("unknown mod file key: " + target);
  const dest = join(outDir, PATHS[target]);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, content, "utf8");
}
console.log("claude-mod regenerated (" + files.length + " files, engine inlined)");
