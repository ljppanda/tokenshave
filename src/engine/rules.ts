/**
 * Per-tool shaving rules.
 *
 * A rule decides how aggressively we trim the output of a given command:
 *  - head:   always keep the first N lines (banner, first file listed...)
 *  - tail:   always keep the last N lines (summaries live at the bottom)
 *  - keep:   always keep any line matching this (errors, failures)
 *  - budget: if the whole output fits in this many lines, leave it untouched
 */

export interface ShaveRule {
  name: string;
  /** matches the tool command string, e.g. "npm install express" */
  match: RegExp;
  head: number;
  tail: number;
  keep?: RegExp;
  budget: number;
}

/** Lines that always matter regardless of tool. No leading \b on "error":
 * "AssertionError" etc. must match too (letter before "Error" kills \b).
 * TAP "not ok" carries failing test names that no other line repeats, and
 * live QA caught shaving them (VERIFY.md). */
export const ALWAYS_KEEP = /(failed|fails|failure|fatal|error|not ok|warn(?:ing)?|exception|panic|denied|exit(?:ed)? with|exit code|ENOENT|ENOTFOUND|ERESOLVE|EACCES|ERR!|✗|✖|●)/i;

/**
 * Tool families. Order matters: first match wins, so put the
 * most specific rules at the top.
 */
export const RULES: ShaveRule[] = [
  {
    name: "package-manager-install",
    // npm install / pnpm add / yarn add / pip install / cargo add / go get / docker pull
    match:
      /(^|[\s(])(npm|pnpm|yarn|bun)\s+\w*i(nstall|all)?\b|(^|[\s(])(npm|pnpm|yarn|bun)\s+add\b|pip3?\s+install|cargo\s+add|go\s+get\b|docker\s+pull\b|apt(-get)?\s+install|brew\s+install/,
    head: 3,
    tail: 8,
    keep: ALWAYS_KEEP,
    budget: 20,
  },
  {
    name: "test-runner",
    // vitest / jest / pytest / rspec / go test / cargo test / npx playwright
    match:
      /\b(vitest|jest|pytest|rspec|playwright|mocha|karma)\b|^go\s+test\b|\bcargo\s+test\b|(^|[\s(])node\s+--test\b/,
    head: 4,
    tail: 12,
    keep: ALWAYS_KEEP,
    budget: 40,
  },
  {
    name: "compiler",
    // tsc / gcc / clang / go vet / cargo build
    match:
      /\btsc\b|(^|[\s(])gcc|(^|[\s(])clang|go\s+vet\b|cargo\s+build\b|gradle\s+\w*build|mvn\s+\w*package/,
    head: 4,
    tail: 10,
    keep: ALWAYS_KEEP,
    budget: 40,
  },
  {
    name: "bundler-build",
    // vite build / webpack / next build / esbuild / rollup
    match: /\b(vite|webpack|esbuild|rollup)\s+build|next\s+build\b|turbopack\b/,
    head: 4,
    tail: 12,
    keep: ALWAYS_KEEP,
    budget: 40,
  },
  {
    name: "http-client",
    // curl/wget/postman style — headers and 200-line HTML bodies are noise
    match: /(^|[\s(])curl\b|(^|[\s(])wget\b(?!\s+-O)/,
    head: 4,
    tail: 6,
    keep: /(\b\d{3}\b)|(^HTTP\/)|content-|set-cookie/i,
    budget: 30,
  },
];

/** Fallback for tools with no dedicated rule. */
export const GENERIC_RULE: ShaveRule = {
  name: "generic",
  match: /.*/,
  head: 10,
  tail: 20,
  keep: ALWAYS_KEEP,
  budget: 80,
};

export function ruleFor(tool: string): ShaveRule {
  return RULES.find((r) => r.match.test(tool)) ?? GENERIC_RULE;
}
