#!/usr/bin/env node
import { aggregate, loadStats } from "./stats.js";
import { join } from "node:path";
import { installPlugins, uninstallPlugins, type InstallReport, type UninstallReport } from "./install.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

const HELP = `${BOLD}tokenshave${RESET} — make your coding agent cheaper, one shaved log at a time.

Usage
  tokenshave install      wire the plugins (OpenCode + Claude Code)
  tokenshave uninstall    remove the plugin files this tool created
  tokenshave stats        show what you saved so far
  tokenshave --help       this text
`;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function pct(raw: number, kept: number): string {
  if (raw <= 0) return "-";
  return Math.round(((raw - kept) / raw) * 100) + "%";
}

export async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];

  if (cmd === "--help" || cmd === "-h" || cmd === "help" || !cmd) {
    console.log(HELP);
    return;
  }

  if (cmd === "install") {
    // resolve before writing: if a user pins this to a scratch npx cache,
    // the plugin should point somewhere stable — warn about that honestly
    const reports = installPlugins(process.cwd()).catch((err) => {
      console.error(`install failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return [] as InstallReport[];
    });
    const done = await reports;
    if (done.length > 0) {
      for (const r of done) {
        const icon = r.action === "created" ? `${GREEN}created${RESET}` : r.action;
        const agent = r.agent === "opencode" ? `${DIM}[opencode]${RESET}` : `${DIM}[claude]${RESET}`;
        console.log(`  ${icon}  ${agent}  ${r.file}`);
      }
      const claudeDir = done.find((r) => r.agent === "claude" && r.action !== "left-foreign-file");
      if (claudeDir) {
        console.log(`
${BOLD}Claude Code${RESET}: register the project-local marketplace once (from your shell, in this project):`);
        console.log(`  claude plugin marketplace add ${join(process.cwd(), ".tokenshave", "claude")} --scope project`);
        console.log(`${DIM}(or run /plugin marketplace add ./.tokenshave/claude in a Claude Code session, then commit .claude/settings.json for teammates)${RESET}`);
      }
      console.log("\nReload opencode (or run /reload) in this project, then use it for a bit.");
      console.log(`Check savings with ${BOLD}tokenshave stats${RESET}.`);
      console.log(
        `${DIM}\nNote: if you ran this via npx, the on-disk npx cache holds the engine.` +
          `\nFor a stable install (and to keep the plugin working after cache cleanup),${RESET}`,
      );
      console.log(`run ${BOLD}npm i -g tokenshave${RESET} and re-run install.`);
    }
    return;
  }

  if (cmd === "uninstall") {
    const done = await uninstallPlugins(process.cwd());
    for (const r of done) {
      const icon = r.action === "removed" ? `${GREEN}removed${RESET}` : r.action;
      console.log(`  ${icon}  ${r.file}`);
    }
    return;
  }

  if (cmd === "stats") {
    const costPerMillion = Number(process.env.TOKENSHAVE_COST_PER_M ?? 3) || 3;
    const entries = await loadStats();
    if (entries.length === 0) {
      console.log(`${DIM}No stats yet. Stats appear once your agent hook is wired up.${RESET}`);
      return;
    }
    const agg = aggregate(entries, costPerMillion);

    console.log();
    console.log(
      `${BOLD}tool${RESET}            ${BOLD}calls${RESET}  ${BOLD}raw tok${RESET}  ${BOLD}kept tok${RESET}  ${BOLD}saved${RESET}`,
    );
    for (const t of agg.byTool.slice(0, 15)) {
      const name = t.tool.padEnd(16).slice(0, 16);
      console.log(
        `${name}  ${String(t.calls).padStart(5)}  ${fmt(t.rawTokens).padStart(8)}  ${fmt(t.keptTokens).padStart(8)}  ${GREEN}${pct(t.rawTokens, t.keptTokens).padStart(6)}${RESET}`,
      );
    }
    console.log("─".repeat(52));
    console.log(
      `${BOLD}total${RESET}          ${String(agg.entries).padStart(5)}  ${fmt(agg.rawTokens).padStart(8)}  ${fmt(agg.keptTokens).padStart(8)}  ${GREEN}${pct(agg.rawTokens, agg.keptTokens).padStart(6)}${RESET}`,
    );
    console.log(
      `\n≈ ${GREEN}${BOLD}$${agg.savedCost.toFixed(2)}${RESET} saved (input @ $${agg.costPerMillion}/M tokens, override with TOKENSHAVE_COST_PER_M)`,
    );
    return;
  }

  console.error(`unknown command: ${cmd === undefined ? "" : cmd}\n`);
  console.log(HELP);
  process.exitCode = 1;
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
