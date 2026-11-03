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

**npm 0.6.0 release (2026-11-02, VERIFIED — including one caught-and-fixed
publish incident):**

- Stage 1: `npm stage publish` staged 0.6.0 (prepublishOnly re-ran build +
  24/24 tests inside the staging flow). **Incident:** the staged npm
  validator auto-corrected and REMOVED the bin entry
  (`"bin[tokenshave]" script name "./dist/src/cli.js" was invalid and
  removed`). Left uncaught, 0.6.0 would have shipped without a running
  `npx tokenshave` — 0.5.0's bin path (no `./` prefix) was fine, 0.6.0's
  had been changed to `./dist/src/cli.js`. Caught via the stage warning,
  fixed in package.json (bin path without `./`), committed
  (`a75072d`), pushed.
- Rejecting the bad staged record: `npm stage reject <id>` requires a 2FA
  OTP (EOTP). In a non-interactive shell npm MASKS the OTP url
  (`https://www.npmjs.com/auth/cli/**`) — in output AND in the debug log —
  so the CLI flow is a dead end here. npmjs.com's **Staged Packages** tab
  is the reliable channel: the maintainer rejected the bad record there.
- Stage 2 ( fixed bin): re-staged (`npm stage list` confirmed the old
  record gone, new id `81670035-…`), then downloaded the staged tarball
  (`npm stage download`) and unpacked package.json from it —
  `bin = {"tokenshave":"dist/src/cli.js"}` verified present BEFORE
  approval. Maintainer approved on the same web tab.
- Immediately post-approve, live registry checks: `npm view tokenshave@0.6.0
  --prefer-online` → `latest = 0.6.0`, `bin` intact.
- Live acceptance `e2e/check-npm-publish.mjs` after a fresh registry
  install into a scratch dir: 5/5 — engine `1193 → 183 tok, not ok 42
  kept`; installPlugins exported; claude bundle import-free;
  generateClaudeModFiles → 5 files hooking Bash with inlined engine;
  generateCodexHookFiles → hooks Bash with inlined engine. (Fix on the way
  in: two import paths in the script had double-escaped backslashes —
  repaired before the run.)
- User-facing path exercised `npx tokenshave stats` + `npx tokenshave
  install` from scratch with the real registry: stats printed the ledger
  table; install created all three adapters in one shot (opencode plugin,
  claude mod 6 files incl. marketplace.json, codex hooks.json +
  shave.js).
- Incident cleanup artifact: running `npm install tokenshave@0.6.0` in
  the repo by mistake briefly wrote itself into package.json
  dependencies — reverted with `git checkout --` immediately; the
  published package and repo history were never affected.

## Codex CLI adapter (2026-11-02, VERIFIED at harness level; contract read from source)

Target: Codex CLI 0.166.0 (`@openai/codex`, installed locally without any
OpenAI account). This investigation **reversed the earlier conclusion** that
Codex had no viable rewrite path: the "Modify blocked for LocalShell" /
"output can be replaced only for MCP tools" state was an earlier-build fact.
In 0.166.0 the hooks feature is stable (`codex features list` →
`hooks stable true`, checked locally), and PostToolUse covers shell commands.

**Engine-level facts, read from the openai/codex sources (all paths
codex-rs/...):**

- Shell tools hit hooks under the canonical name **"Bash"**
  (`core/src/tools/hook_names.rs`: `HookToolName::bash()`); matcher "Bash"
  covers exec_command and one-shot shells.
- PostToolUse fires for **every completed** shell command; still-running
  (yielded) sessions fire via the later write_stdin poll
  (`core/src/tools/handlers/unified_exec.rs` +
  `exec_command.rs`).
- stdin `tool_response` is a **plain JSON string** — the model-facing,
  already-truncated output (`core/src/tools/context.rs`:
  `ExecCommandToolOutput::post_tool_use_response` →
  `JsonValue::String(...)`); `tool_input` is `{"command": <raw command>}`.
- **Replacement contract** (`hooks/src/events/post_tool_use.rs` +
  `engine/output_parser.rs` + `core/src/hook_runtime.rs` +
  `core/src/tools/registry.rs`): a sync command hook printing
  `{"continue": false, "reason": "<text>"}` (optionally `stopReason`,
  `systemMessage`) makes Codex wrap `reason` into
  `PostToolUseFeedbackOutput` — the model sees a **normal success-shaped
  result replaced with the feedback text**; the original is retained
  internally only. `decision:"block"` exists but routes to
  `FunctionCallError::RespondToModel` (an error — wrong shape for shaving,
  so tokenshave does not use it). Empty stdout + exit 0 = pass-through.
  Strict schema: `reason` without a decision under `continue:true` → hook
  marked failed → original output survives (fail open); `suppressOutput`
  is unsupported → not sent.
- The hook command runs through the platform shell (`cmd /C` on Windows,
  `engine/command_runner.rs`) — so `shave.js` guarantees its own exit code
  and never relies on shell separators.
- Plugin-bundled hooks live in `hooks/hooks.json` at the plugin root;
  marketplace manifests live at `.agents/plugins/marketplace.json`
  pointing at a payload folder with `.codex-plugin/plugin.json`. Codex
  skips untrusted hooks until the user reviews them in `/hooks` (by
  design, for every plugin hook — documented on developers.openai.com).

**Adapter:** `src/codexHook.ts` generates a self-contained `shave.js`
(engine inlined, zero imports) + `hooks.json`. Two install paths:

1. project-local: `npx tokenshave install` writes `.codex/hooks.json`
   (command = absolute path to `.tokenshave/tokenshave-shave.js`) — the
   user trusts it once via `/hooks`.
2. repo marketplace: `codex plugin marketplace add ljppanda/tokenshave`
   + `codex plugin add tokenshave@tokenshave` (payload committed at
   `codex-mod/`, regenerated by `npm run gen`, CI drift-checked).

**What was verified (all live runs):**

1. Harness run of the real hook process fed the exact 0.166.0 stdin
   contract (`e2e/codex-hook-e2e.mjs`): 220-line synthetic npm output →
   replacement envelope `{continue:false, reason, stopReason}` shaving
   **6977 → 1017 bytes (85%)**, failure line (`not ok 42`) kept
   byte-identical to the real engine, marker line present; small output,
   garbage stdin, and non-Bash tools pass through untouched (empty stdout
   + exit 0). Unit tests mirror this (24/24).
2. Real CLI packaging: `codex plugin marketplace add <repo>` — first
   attempt FAILED with a schema error
   (`authentication: "NONE"` is not a variant; only `ON_INSTALL` /
   `ON_USE`), fix applied, then passed. `codex marketplace list` showed
   the marketplace; `codex plugin add tokenshave@tokenshave` → "installed,
   enabled, 0.5.0" with in-place source `E:\opencode\tokenshave\codex-mod`
   and a 4-file cache. Then `codex plugin remove tokenshave@tokenshave` +
   `codex plugin marketplace remove tokenshave` → machine restored
   (empty cache dir left behind was deleted manually).
3. Note on subcommand naming: install is `codex plugin add` (not
   `install`), remove is `codex plugin remove <plugin>@<marketplace>`.

**Not yet verified (honest edges):**

- A real interactive Codex session firing Bash through the hook. Blocked
  on an OpenAI account/API key — the harness uses the exact wire contract
  read from the running binary's own sources, but a session-level verdict
  must wait. Listed on the README Roadmap with the same wording.
- The trust flow inside `/hooks` (interactive UI) was not exercised; the
  packaging and hook-detection path up to that point did run for real.
- If a model-facing Codex truncation or a future CLI change alters the
  `tool_response` shape, the hook fails open (prints nothing) — worst case
  is no shaving, never wrong content.

## Cursor adapter (2026-11-02, VERIFIED at harness level; contract read from the hooks docs)

Target: Cursor (IDE agent). This machine has **no Cursor install at all**
(`where.exe cursor` / `cursor-agent` find nothing; no desktop app) — so the
verification stops at the documented contract and real spawned processes,
with the live-session verdict listed under honest edges.

**Engine-level facts, read from cursor.com/docs/hooks +
cursor.com/docs/reference/third-party-hooks (checked 2026-11-02):**

- `afterShellExecution` is **observe-only**: input carries
  `command`/`output`/`duration`/`sandbox`, and the docs show no output
  schema — its stated uses are auditing and metrics. Replacing output there
  is not a documented capability.
- `postToolUse` can replace output **only for MCP tools**
  (`updated_mcp_tool_output`); for native `Shell` tools it offers only
  `additional_context`, which is context ADDED after the untouched tool
  result — that grows tokens instead of saving them.
- The one documented rewrite point is **`preToolUse`'s `updated_input`**
  ("Modified tool input to use instead"). That is the mechanism this
  adapter uses.
- Permission hooks (incl. `preToolUse`) **block on invalid/missing
  output**: failing open therefore requires printing a valid
  `{"permission":"allow"}` JSON, not empty stdout. Crash/timeout/other
  exit codes fail open by default (`failClosed:false`), and exit 2 means
  bind-in deny — never emitted.
- Hook command runs on Windows through PowerShell; project hooks run
  with cwd = project root. Cloud agents run project hooks too.

**Adapter:** one self-contained script (`tokenshave-cursor.js`, engine
inlined, zero static imports — dynamic `import("node:child_process")`
keeps it loadable as both CJS and ESM) playing two roles:

1. hook mode (`preToolUse`, matcher `"Shell"`): if the command is in a
   conservative whitelist (named engine rules — installs / test runners /
   compilers / bundlers / curl — plus `npm|pnpm|yarn|bun test`
   spellings), rewrite it to
   `node "<self>" <base64-of-command> tsh-cursor-wrap` via
   `updated_input`. Sandboxed commands are NEVER rewritten (the wrapper
   would unsandbox them — we refuse that behavior change). Watchers
   (`npm run dev`) and interactive commands never match the whitelist.
2. wrapper mode: spawn the original command (`shell:true`), capture
   stdout/stderr separately, shave each with the inlined engine
   (printing the shave only when strictly smaller), and exit with the
   child's exit code. Per-stream capture cap: 2 MB.

Install writes `.cursor/hooks.json` + `.tokenshave/tokenshave-cursor.js`.
The generated `hooks.json` carries **no marker field** (Cursor's schema
is strict and unknown keys are an undocumented risk), so "is this ours"
is decided by the hook command referencing `tokenshave-cursor.js` —
both at install (idempotency) and at uninstall (foreign-file detection).

**What was verified (all live runs):**

1. Unit tests (30/30 total now): hook rewrite shape + base64 round-trip;
   pass-through allow for watcher/git/non-Shell/garbage/empty; sandbox
   and already-wrapped refusal; wrapper engine-identity on a real
   220-line process run (byte-equal to `shave()`), failure line kept,
   stderr channel separate and intact, child's `process.exitCode = 7`
   preserved byte-for-byte as the wrapper's exit code; small output
   byte-identical.
2. `e2e/cursor-hook-e2e.mjs` — 21/21 checks: install files, hooks.json
   schema, rewritten-command execution like Cursor would do it (86%
   smaller "terminal output" for the 220-line synthetic, `not ok 42`
   byte-kept), pass-through family, sandbox/wrapped refusal, garbage→
   valid allow.
3. Real-world behavioral probe (no Cursor needed): the wrapper ran a
   real `npm install left-pad@1.3.0 --no-save` in a scratch dir — exit
   0, package actually installed to node_modules, the deprecation
   warning survived, small output left effectively untouched.

**Not yet verified (honest edges):**

- A session inside the Cursor IDE (no install on this machine). The
  harness uses the docs' exact stdin/response contracts, but a live
  session verdict must wait for an IDE + account. Listed on the README
  roadmap identically.
- `updated_input` behavior when a *second* matching hook defines it too
  (Cursor merges hook responses; per docs the lower-priority source
  wins for non-permission fields — actually exercised by no test here).
- Stream interleaving: stdout/stderr are shaved separately, so the
  captured ordering between the two streams is no longer exact-pty
  faithful. Raw-passthrough commands (non-whitelisted) are unaffected.
- Very long single lines beyond the 2 MB cap: content is dropped with a
  marker rather than shaven — wasteful but loud.

## npm 0.7.0 release + first live-session verdict (2026-11-03, VERIFIED)

- Staged (`249657f8-…`), and this time **the staged tarball was downloaded
  and checked BEFORE asking for approval** (lesson from the 0.6.0 bin
  incident): `bin` intact without the `./` prefix, `dist/src/cursorHook.js`
  + tests + both READMEs in the tarball. Approved on the npmjs.com Staged
  Packages tab; `npm view tokenshave@0.7.0 --prefer-online` → live,
  `bin` present.
- Live registry acceptance `e2e/check-npm-publish.mjs` after a fresh
  install: **6/6** — engine `1193 → 183 tok, not ok 42 kept`; claude mod
  5 files; codex hook; new: cursor hook matcher Shell + `updated_input`
  rewrite + inlined engine.
- **First live session on the freshly published package** (up to now every
  live-session trial ran on the repo working tree): scratch project →
  `npm i tokenshave@0.7.0` → `npx tokenshave install` (11 files created
  across all four agents) → real `opencode v2.2.0 run --auto` session
  (desktop's `opencode-cli.exe`) with a synthetic 268-line CI log and a
  failing test buried mid-run. The agent answered correctly
  (`refund twice exceeds balance`) and the ledger recorded the shave:
  **`node biglog.cjs`, rule generic, 1,985 → 264 tok (87%), 268 → 35
  lines**. `npx tokenshave stats` prints the aggregated ledger (69%
  saved total across all recorded sessions, ≈$0.07 at $3/M).
- Note: `opencode` on PATH resolves to the desktop install's
  `resources/opencode-cli.exe`; used directly for the session.

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
