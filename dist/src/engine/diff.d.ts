/**
 * Shaving for unified diffs (git diff): context lines are the least
 * valuable and the most repetitive. Keep everything that expresses a
 * change; drop pure context.
 *
 * Also collapses non-diff noise (git stderr like CRLF warnings) that got
 * mixed into the tool result — it is hard to read without diff structure
 * and often repeats dozens of times.
 */
export declare function shaveDiff(output: string): {
    output: string;
    removed: number;
};
