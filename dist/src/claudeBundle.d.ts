/**
 * Bundles the compiled engine modules (dist/src/engine/*.js) into ONE
 * self-contained ESM source string, suitable for inlining into a generated
 * Claude Code mod.
 *
 * Claude Code's mod loader forbids imports of anything except files inside
 * the plugin directory (relative paths) and the `claude-code` package
 * (verified with `claude plugin validate` on 2.1.314 — the checker rejects
 * `node:fs` with: "a hooks module imports its own files by relative path
 * and `claude-code`, nothing else"). The engine is pure computation and
 * needs no imports at all, so the bundle is a single import-free module.
 */
export declare function loadEngineBundle(): Promise<string>;
