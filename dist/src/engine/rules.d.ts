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
export declare const ALWAYS_KEEP: RegExp;
/**
 * Tool families. Order matters: first match wins, so put the
 * most specific rules at the top.
 */
export declare const RULES: ShaveRule[];
/** Fallback for tools with no dedicated rule. */
export declare const GENERIC_RULE: ShaveRule;
export declare function ruleFor(tool: string): ShaveRule;
