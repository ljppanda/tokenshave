/**
 * Shaving for unified diffs (git diff): context lines are the least
 * valuable and the most repetitive. Keep everything that expresses a
 * change; drop pure context.
 *
 * Also collapses non-diff noise (git stderr like CRLF warnings) that got
 * mixed into the tool result — it is hard to read without diff structure
 * and often repeats dozens of times.
 */

/** A diff line: adds, deletions, hunk headers, headers, "\ No newline" notes. */
const DIFF_SYNTAX = /^(\+|-|@@|\\|diff --git|index |--- |\+\+\+ )/;

const MARKER = "␥ ... (tokenshave: %d of %d diff lines removed)";

export function shaveDiff(output: string): { output: string; removed: number } {
  const lines = output.split("\n");
  const total = lines.length;

  const kept: string[] = [];
  const noise: string[] = [];
  let contextRemoved = 0;

  for (const line of lines) {
    // unified diff context line starts with a single space
    const isContext =
      line.startsWith(" ") && !line.startsWith(" +++") && !line.startsWith(" ---");
    if (isContext) {
      contextRemoved++;
      continue;
    }
    if (!DIFF_SYNTAX.test(line)) {
      // stderr noise mixed into the tool result
      noise.push(line);
      continue;
    }
    kept.push(line);
  }

  // keep the first two noise lines in case a lone error lives there
  const noiseKept = noise.slice(0, 2);
  const removed = contextRemoved + (noise.length - noiseKept.length);

  if (removed === 0) return { output, removed: 0 };

  const out: string[] = [
    MARKER.replace("%d", String(removed)).replace("%d", String(total)),
  ];
  out.push(...noiseKept);
  out.push(...kept);

  return { output: out.join("\n"), removed };
}
