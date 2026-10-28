/**
 * tokenshave — make your AI coding agent cheaper by shaving verbose
 * tool output before it enters the context window.
 *
 *   import { shave } from "tokenshave";
 *   const { output, rawTokens, keptTokens } = shave("npm install", npmOutput);
 *
 * Pure functions, zero dependencies, zero network. All shaving decisions
 * stay visible: shaved text carries a marker line stating what was removed.
 */

export { shave, type ShaveResult } from "./engine/trim.js";
export { RULES, GENERIC_RULE, ruleFor, ALWAYS_KEEP, type ShaveRule } from "./engine/rules.js";
export { estimateTokens } from "./engine/tokens.js";
export {
  record,
  loadStats,
  aggregate,
  statsDir,
  type StatEntry,
  type Aggregate,
  type ToolStats,
} from "./stats.js";
export {
  installPlugins,
  uninstallPlugins,
  generatePluginSource,
  defaultPackageUrl,
  pluginTargets,
  INSTALL_MARKER,
  type InstallReport,
  type UninstallReport,
} from "./install.js";
