#!/usr/bin/env node
// Regenerates the repo's codex-mod/ directory (the Codex CLI plugin payload)
// from the compiled engine. The output is committed, and CI re-runs this
// script and fails on any content drift (git diff --exit-code), so the
// in-repo plugin can never go stale relative to src/.
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCodexHookFiles } from "../dist/src/codexHook.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "codex-mod");

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

const generatedAt = "repo build — regenerate with `npm run gen:codex-mod`";
const files = await generateCodexHookFiles(
  generatedAt,
  pkg.version,
  'node "${PLUGIN_ROOT}/hooks/shave.js"',
);
const PATHS = {
  hooksJson: "hooks/hooks.json",
  shaveJs: "hooks/shave.js",
  pluginJson: ".codex-plugin/plugin.json",
  readme: "README.md",
};
await rm(outDir, { recursive: true, force: true });
for (const key of Object.keys(PATHS)) {
  if (files[key] === undefined) throw new Error("missing generated file: " + key);
  const dest = join(outDir, PATHS[key]);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, files[key], "utf8");
}
console.log("codex-mod regenerated (" + Object.keys(PATHS).length + " files, engine inlined)");
