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
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
/** base directory of the compiled package (dist/src) */
const BASE = dirname(fileURLToPath(import.meta.url));
/** engine modules concatenated in dependency order */
const BUNDLE_FILES = [
    "engine/tokens.js",
    "engine/diff.js",
    "engine/rules.js",
    "engine/trim.js",
];
/** converts `export function f` / `export const x` to plain declarations */
function unexport(source) {
    return source
        .replace(/^export async function /gm, "async function ")
        .replace(/^export function /gm, "function ")
        .replace(/^export const /gm, "const ")
        .replace(/^export (?:interface|type)\s[^\n{]*\{[\s\S]*?^\}\n?/gm, "")
        // `export { a, b };` — nothing we ship relies on, drop it
        .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, "");
}
/** strips module-local (relative) imports; other specifiers fail loudly */
function stripImports(source) {
    const out = source.replace(/^import(?:\s+type)?\s[\s\S]*?\bfrom\s*(["'])(.+?)\1\s*;?\s*$/gm, (_m, _q, spec) => (spec.startsWith(".") ? "" : `\n!!KEEP-IMPORT!! from ${spec}\n`));
    if (out.includes("!!KEEP-IMPORT!!")) {
        throw new Error("engine bundle: bare (non-relative) import found; engine must be dependency-free");
    }
    return out;
}
export async function loadEngineBundle() {
    const parts = [];
    for (const rel of BUNDLE_FILES) {
        const source = await readFile(join(BASE, rel), "utf8");
        const cleaned = stripImports(unexport(source));
        parts.push(`// --- ${rel} ---\n${cleaned}`);
    }
    const bundle = parts.join("\n");
    // fail loudly rather than generate a broken mod
    if (/^export /m.test(bundle))
        throw new Error("engine bundle: residual export statement");
    if (/from\s+["']\.\.?\//.test(bundle))
        throw new Error("engine bundle: residual relative import");
    return bundle.trimEnd() + "\n";
}
