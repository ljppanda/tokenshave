// Final live-registry acceptance: install tokenshave@0.6.0 from npm and run
// the engine + generators exactly as a library user would.
const dir = process.env.TEMP + "\\ts-livetest\\node_modules\\tokenshave";
const m = await import("file:///" + dir.replace(/\\/g, "/") + "/dist/src/index.js");

// 1. engine shaves a synthetic npm test run, keeping the failure
const raw = Array.from({ length: 220 }, (_, i) => `ok ${i} - passing case`).join("\n")
  + "\nnot ok 42 - test/e2e.js\nreal error line";
const r = m.shave("npm test --silent", raw);
const version = m.version ?? "live";
console.log("1. engine:", r.rule, "|", r.rawTokens, "->", r.keptTokens, "tok | not ok kept:", r.output.includes("not ok 42"));

// 2. adapters installable from code as well
const inst = await import("file:///" + dir.replace(/\\/g, "/") + "/dist/src/install.js");
console.log("2. installPlugins + claudeMod generators exported:", typeof inst.installPlugins === "function");

// 3. the generator produces a self-contained claude mod (no imports)
const bundle = await import("file:///" + dir.replace(/\\/g, "/") + "/dist/src/claudeBundle.js");
const engineBundle = await bundle.loadEngineBundle();
console.log("3. claude engine bundle: no imports:", !/^\s*import /m.test(engineBundle), "| no exports:", !/^export /m.test(engineBundle));

// 4. claudeMod generates files with the inlined engine
const mod = await import("file:///" + dir.replace(/\\/g, "/") + "/dist/src/claudeMod.js");
const files = mod.generateClaudeModFiles("livetest", engineBundle, "0.6.0");
const registerJs = files.find(f => f.target === "registerJs").content;
console.log("4. mod files:", files.length, "| register hooks Bash:", registerJs.includes('on("tool.call", { tool: "Bash" }'), "| inlined shave:", registerJs.includes("function shave"));

// 5. the codexCodex hook generates with the inlined engine
const codexGen = await import("file:///" + dir.replace(/\\/g, "/") + "/dist/src/codexHook.js");
const codexFiles = await codexGen.generateCodexHookFiles("livetest", "0.6.0", 'node "shave.js"', engineBundle);
console.log("5. codex hook:", "hooks Bash:", codexFiles.hooksJson.includes('"Bash"'), "| inlined shave:", codexFiles.shaveJs.includes("function shave"));

