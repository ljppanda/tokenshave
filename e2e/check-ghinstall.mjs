const dir = process.env.TEMP + "/ts-ghinstall2/node_modules/tokenshave";
const m = await import("file:///" + dir.replace(/\\/g, "/") + "/dist/src/index.js");
const raw = Array.from({ length: 100 }, (_, i) => `ok ${i} - case`).join("\n") + "\nnot ok 42 - real failure";
const r = m.shave("npm test", raw);
console.log("engine workable: rule", r.rule, "| kept", r.keptLines + "/" + r.rawLines, "| not ok kept:", r.output.includes("not ok 42"));
const cli = await import("file:///" + dir.replace(/\\/g, "/") + "/dist/src/install.js");
console.log("install module OK, targets:", cli.pluginTargets("C:/x").length);
