# Verification

How `tokenshave` claims its numbers, and what is (not yet) verified.

## Live-session acceptance (2026-10-28, VERIFIED)

Ran a real OpenCode 2.2.0 agent session (`opencode run --auto`) in a fresh
project with the generated plugin installed:

```
plugin-debug.log: shave tool=shell rule=generic 5176 -> 1913
stats:            shell  1 call  5,176 raw  1,913 kept  63%
```

Agent's final answer still quoted the exact error line — shaving didn't
hurt task quality.

## Multi-scenario live acceptance (2026-10-28, VERIFIED)

Second QA round against the same real CLI, four scenarios plus a regression
re-check. Fresh stats ledger each round; all numbers below are plugin-debug /
`tokenshave stats` receipts, not estimates.

| Scenario | command | rule | raw → kept | agent's answer |
|---|---|---|---|---|
| S1 quiet success | `node -e 'console.log(42)'` | no shave (<50 chars) | — | "It succeeded." ✅ |
| S2 43 tests, 20 fail | `node --test test/math.test.cjs` | test-runner | 4,951 → 1,146 (77%) | exact first failing test name ✅ |
| S3 29 scattered edits | `git diff -- src/big.js` | diff | 4,201 → 882 (79%) | "29 insertions, 29 deletions" ✅ |
| S4 fact buried at line 150 | `node secret.js` | generic | 3,667 → 1,238 (66%) | exact URL ✅ (self-healed, see below) |

The S4 answer deserves honesty: the URL line is inside a shaved gap, so the
agent first saw only the marker. It then re-ran a filtered command
(`Get-ChildItem`-style, small output never triggers a shave) and recovered the
URL itself. The marker's honesty is what makes the self-heal possible — this
is a designed escape hatch working under real conditions, not proof that
shaving preserves everything. Confirmed twice (S4, S4b); counts below use the
plugin's own journal.

Facts this round pinned down (all encoded in the generator now):

- Rules **must** key on `event.input.command` (e.g. `node --test …`), not the
  tool name — otherwise every real session runs under the generic rule only.
- TAP "not ok" lines carry failing test names available nowhere else; live QA
  caught the agent answering with the *file name* instead. `not ok`/`fails`
  added to ALWAYS_KEEP, plus a regression test (S2 now exact).
- `~/.tokenshave/plugin-debug.log` journal + the receipts it produced were
  load-bearing again: without it we'd have shipped a "63%" that silently
  degraded to 49%.
- **OpenCode's resident serve process caches plugin modules**: after
  rebuilding, `opencode run` still reported old numbers until the serve was
  restarted. Documented because future contributors will hit this when
  hacking on the engine — restart the serve (or reboot the desktop app)
  before trusting live stats.

More facts from round one (2026-10-28):

- V2 tool name is **"shell"**, not "bash" (V1 name kept as an accepted alias)
- V2 shell result shape: `{ output: { exit, truncated, output: "<text>" } }`
  → the plugin reads `result.output.output`
- OpenCode auto-loads plugins from `.opencode/plugins/`, then walks
  ancestor directories — stale files from experiments double-register
- `console.log` from a plugin does not reliably reach opencode.log; the
  plugin keeps its own journal at `~/.tokenshave/plugin-debug.log`

## Round 3: regression + common scenarios (2026-10-28, VERIFIED)

Same sandbox, fresh fixtures, after the marker and rule-keying fixes. All
numbers from the plugin journal; agent answers quoted verbatim.

| # | scenario | rule | raw → kept | agent's answer |
|---|---|---|---|---|
| R1 | 43 tests, 20 fail (regression) | test-runner | (S2 numbers stand) | `"div fails on purpose"`, `AssertionError: 5 == 6` ✅ |
| R2 | 28 scattered edits, git diff (regression) | diff | 3,767 → 693 (82%) | "28 insertions / 28 deletions", saw `QA-EDIT-7` in kept context ✅ |
| L1 | `npm install` success (small) | untouched | — | "added 1 package" ✅ |
| L2 | ERESOLVE failure | **none, 231 → 231** | byte-identical | quoted `npm error code ERESOLVE` + `peer react@"^16.14.0"` verbatim ✅ |
| L3 | tsc --noEmit, 159 error lines | **none, 159 → 159** | every line is an error → keep all | answered "MODULE_NOT_FOUND" — count reply unreliable (model, not shave; raw was in context untouched) ⚠️ honest note |
| L4 | `curl -o NUL -w %{http_code}` | untouched (3 chars < 50 floor) | — | "200 (OK)" ✅ |

R2 also caught the **self-heal double-command pattern in the journal**:
first `git --no-pager diff` (shaved), then the agent itself ran
`git --no-pager diff --stat -- src/big.js` → 32 lines, under budget, untouched.

Offline re-verification with the round's captured outputs (`offcheck.mjs`):

- real ERESOLVE dump: byte-identical, 0% saved ✅ (promise: errors = payload)
- 25+ line all-error dump over budget: byte-identical ✅ (covered by unit test)
- TAP failing names survive: 21 `not ok` lines kept ✅
- marker flood: 1 HEAD_NOTE, no repeated long markers ✅
- classification: `node <…>/tsc --noEmit` → compiler rule; mixed
  errors+noise → 35% saved; pure error output → 0% (correct)

Honest findings about npm: on npm 10 with a mirror registry, a *successful*
install is 8–10 lines (no verbose HTTP logs exist anymore) — the
package-manager rule has nothing to shave on success; savings on that family
come from failure dumps and deprecation-warn spam. A misnamed fixture
(`out-npm-fail.txt`, actually a successful enzyme install with warns) taught
the harness to double-check content before labeling — kept as
`out-npm-enzyme.txt`.

The full multi-command session ledger:

```
tool            calls  raw tok  kept tok  saved
node                7   21,222     7,355    65%
git                 3    8,000     1,607    80%
npm                 1      231       231     0%   (ERESOLVE untouched)
Get-ChildItem       1      375       375     0%
ls                  1       73        73     0%
total              13   29,901     9,641    68%   ≈ $0.06
```

## Claude Code adapter (2026-10-30, VERIFIED at harness level)

Target: Claude Code 2.1.314 CLI (`@anthropic-ai/claude-code` npm package,
installed locally without any API account). All commands below ran for real;
nothing here is projected.

**Adapter form** — not a PostToolUse shell hook. Facts first:

- The docs settled it: PostToolUse shell hooks **cannot rewrite
  tool_response** (only `additionalContext` / `decision:"block"`);
  `updatedInput` belongs to PreToolUse and requires allow/ask. Rewriting the
  output Claude reads needed a different door.
- The mod API (in-process plugin hooks) has `tool.call` middleware:
  `const result = await next(e)`, then return a modified copy — Claude reads
  the rewritten result. Same design as the OpenCode plugin; one engine, both
  agents.

**Result/event shapes, observed for real:**

- Bash event: `e.tool === "Bash"`, `e.command` is the shell command
  (equivalent of OpenCode's `event.input.command`).
- Bash result record: `{ stdout: string; stderr: string; interrupted;
  ... }` (`BashOutput` in `sdk-tools.d.ts`, shipped in the npm package).
- `await next(e)` resolves directly to that record when the tool ran;
  when another hook answered instead, a hook receives an envelope
  `{ result: <answer> }`. The generated hook accepts both shapes
  (observed via `claude plugin test` — first run did NOT shave because the
  hook read the envelope; fixed before shipping).
- A settings-hook-less mod cannot import `node:fs`: `claude plugin
  validate` rejects it verbatim — "a hooks module imports its own files by
  relative path and `claude-code`, nothing else". The generated mod is
  therefore fully self-contained: the engine is bundled inline,
  zero imports, no stats recording (honest limitation, on the Roadmap).

**What was verified (all live runs):**

1. `claude plugin validate` on the generated mod: PASS
   (`tool.call{tool=Bash}` hook + `.catch` fail-open detected as intended;
   one non-blocking ICON_MISSING warning remains).
2. `claude plugin test` with a test that fires `$.tool.call({tool: "Bash",
   command: "npm test --silent"})` against a stubbed 228-line synthetic npm
   output containing `not ok 42 - test/e2e-failure.js`: PASS — stdout went
   228 lines → 30, `not ok 42` kept byte-identical, `tokenshave` HEAD_NOTE
   marker present.
3. `claude plugin marketplace add E:\opencode\tokenshave` (local directory
   marketplace) + `claude plugin install tokenshave@tokenshave --yes`:
   installed, enabled, and "Read from" pointed at the repo dir (in-place
   load). Then uninstalled + marketplace removed, machine restored.
4. Same via the **remote GitHub marketplace**
   (`claude plugin marketplace add ljppanda/tokenshave` — it clones the
   repo): installed 0.5.0 successfully. Note: the first attempt failed with
   "Marketplace file not found" — the repo on GitHub did not yet contain
   `.claude-plugin/marketplace.json`; that failure itself confirmed the
   clone-then-validate mechanism works, and the retry after push passed.
   Then uninstalled, machine restored.
5. `tokenshave install` in a scratch project writes both adapters:
   `.opencode/plugins/tokenshave.ts` + self-contained `.tokenshave/claude/`
   mod; `tokenshave uninstall` removes all six files (unit-tested 20/20).
6. Equivalence test: the inline engine in the generated mod produces
   **byte-identical** shave output to the real engine (unit test).

**Not yet verified (honest edges):**

- A real interactive Claude session (live chat) firing Bash through the mod.
  Blocked on an Anthropic API key — `claude plugin test` fires real events
  through the real hook chain, but it is a harness verdict, not a live-chat
  verdict. Listed on the README Roadmap with the same wording.
- Marketplace submission review (bot safety scan) — only relevant when
  submitting to Anthropic's directory; local/own-marketplace installs do not
  require it.
- `ICON_MISSING`: the mod has no icon; cosmetic, flagged by the validator as
  a directory-submission warning only.

**npm 0.5.0 release (2026-10-30, VERIFIED):**

- `npm stage publish` → maintainer approval on npmjs.com (the staged entry
  showed as "Validating: automated review" first — with no actionable button,
  which is normal; approval was already registered through the stage-time
  web login) → **live at 06:56 UTC**, `latest → 0.5.0`, 28 files (the four
  new: `dist/src/claudeBundle.{js,d.ts}`, `dist/src/claudeMod.{js,d.ts}`).
- Local verification after publish, run live: `npm view tokenshave@0.5.0` →
  0.5.0 (needed `--prefer-online`: the local npm cache held a stale
  packument and briefly reported ETARGET "No matching version" — a local
  cache artifact, not registry state; direct registry fetch returned 200
  throughout). A scratch install from the registry then ran the full
  acceptance script `e2e/check-npm-publish.mjs`: engine saves tokens and
  keeps the failing line, all generator APIs work, generated mod is
  import-free and hooks Bash.
- Front page marketing cirle closed: `npx tokenshave install` in any
  project now wires BOTH agents, and Claude-only users never touch npm at
  all (`/plugin marketplace add ljppanda/tokenshave`, live-verified).

## Method

1. Capture real command output on a real machine (Windows 11, Node 22,
   Python 3.14, git 2.49, npm 10).
2. Run the output through `shave()`.
3. Token counts come from a real BPE tokenizer (`gpt-tokenizer`, o200k),
   not our internal estimate. Internal `estimateTokens` (chars ÷ 4)
   undercounts real tokens by ~13–35% and is display-only.

Result of the last run:

| Case | raw tok | shaved tok | saved |
|---|---|---|---|
| `node --test`, 61-line TAP output | 497 | 225 | 55% |
| `git diff`, 28 scattered edits, 200-line file | 3,134 | 771 | 75% |
| `pip install` cache hit, 17 lines | 506 | 506 | 0% ✅ untouched |
| `npm install` ERESOLVE failure dump | 282 | 282 | 0% ✅ untouched |

## Bugs this verification caught (and fixed)

- UTF-16LE redirection poisoning: PowerShell's `>` writes UTF-16LE, which
  broke every line-prefix check. Fixed by capturing through `cmd /c`;
  the engine itself is unaffected but be aware when writing test fixtures.
- `AssertionError`: a leading `\b` on `error` missed "assertion**Error**".
  Errors are the payload; regex rewritten.
- Empty-output bug: after dedupe, a sentinel `kept: []` could blank the
  entire output. Sentinel semantics fixed.
- Cosmetic shaves: dropping only blank lines still emitted a marker and
  changed bytes. Now byte-identical passthrough.
- Over-budget errors: budget trimming could drop genuine error lines.
  Budget no longer applies to keep-matches; repeated-warning spam is
  handled by run-collapse instead.
- Marker flood: a keep-match every N lines emitted a full marker per gap
  (54 near-identical marker lines in a 302-line log — live S4 shave
  degraded from 66% to 49%). Fixed: one HEAD_NOTE line at the top states
  the totals; each interior gap is a minimal `(… +N trimmed)`.
- Rule keying: shaving was keyed on the tool name (`shell`), so every real
  session fell through to the generic rule. Now keyed on the command the
  shell executed (`event.input.command`).

## Not yet verified (the acceptance tests for v0.4)

- Long-horizon real usage: multi-day sessions, mixed workloads, the
  aggregate cost line in `tokenshave stats` matching an actual bill.
- Model comprehension of shaved output at scale (four live sessions answered
  correctly; the S4 self-heal was observed twice, but more workloads are
  needed before claiming zero quality cost). Mitigation: every shave carries
  a marker.
- Claude Code adapter — VERIFIED at harness level 2026-10-30 (see the
  section above); a live interactive session remains open.
