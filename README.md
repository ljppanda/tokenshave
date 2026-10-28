# tokenshave

English | [简体中文](README.zh-CN.md)

**Make your AI coding agent faster and cheaper. Automatically.**

`tokenshave` sits between your AI coding agent and the tools it runs, and trims
the verbose output (npm install logs, test suites, diffs) that eats your tokens
before it enters the context window.

- **Pure local processing** — no network, no device, no daemons
- **Zero runtime dependencies** — one file of pure functions
- **Transparent** — every shaved output carries a marker line saying exactly what was removed
- **Reversible** — errors, failures and summaries are always kept

## Why

Verified with real captured outputs and a real BPE tokenizer (GPT o200k):

| Real output captured | raw → shaved | saved | why |
|---|---|---|---|
| `node --test` (61 lines of TAP) | 497 → 225 tok | **55%** | per-test ok-lines are noise |
| `git diff`, 28 scattered edits in a 200-line file | 3,134 → 771 tok | **75%** | context lines dominate |
| `pip install` (cache hit, 17 lines) | 506 → 506 tok | 0% | correctly left untouched |
| `npm install` failure (ERESOLVE dump) | 282 → 282 tok | 0% | error output = payload, kept byte-identical |

Note for honesty: a *successful* `npm install` on npm 9+ is ~12 lines and is
not a pain point. Savings come from test runners, verbose builders, repeated
warnings and diff context. See [VERIFY.md](VERIFY.md) for the methodology.

## Status: v0.4.0 – four live scenarios verified in real OpenCode sessions

Engine (18/18 tests), stats ledger, and an OpenCode V2 plugin shaving **shell**
output live. Acceptance ran real agent sessions (`opencode run --auto`) across
four scenarios — quiet success, failing test-runs, scattered diffs, and a fact
buried mid-log — every one answered correctly by the agent, at 66–79% fewer
tokens (receipts in [VERIFY.md](VERIFY.md), e.g. `4,951 → 1,146 tok, exact
failing test name`). Install:

```bash
cd your-project && npx tokenshave install
```

Only `shell` results are shaved — `read`/`edit` comprehension stays intact.
Claude Code adapter comes next.

## Quick start

```bash
cd your-agent-project
npx tokenshave install    # writes .opencode/plugins/tokenshave.ts (OpenCode V2)
npm i -g tokenshave       # keeps the engine in a stable global location
/reload your agent and work as usual
npx tokenshave stats      # see what you saved
```

```ts
import { shave, record } from "tokenshave";

const raw = await runTool("npm install express");
const result = shave("npm install express", raw.output);

// hand the trimmed text to the agent
await runTool(result.output);

// remember what you saved
record({
  tool: "npm install express",
  rule: result.rule,
  rawLines: result.rawLines,
  keptLines: result.keptLines,
  rawTokens: result.rawTokens,
  keptTokens: result.keptTokens,
});
```

## See what you saved

```bash
npx tokenshave stats
```

```
tool            calls  raw tok  kept tok   saved
npm                 3    12,400     1,100     91%
git diff            1     3,200       40      98%
────────────────────────────────────────────────────
total               4    15,600     1,140     93%

≈ $0.04 saved (input @ $3/M tokens, override with TOKENSHAVE_COST_PER_M)
```

## How the engine works

For every tool output, `shave()` applies a per-tool rule:

| rule family | what's kept |
|---|---|
| package-manager-install | head 3 + tail 8 lines, every error line |
| test-runner | head 4 + tail 12, every `failed`/`✗`/`AssertionError` line |
| compiler | head 4 + tail 10, every compile error |
| bundler-build | head 4 + tail 12, warnings + errors |
| http-client | headers, status codes, set-cookie |
| unified diff | hunk headers and ± lines, context dropped |
| generic fallback | head 10 + tail 20, errors |

Small outputs (under the rule's line budget) pass through **untouched** — a
shave that isn't needed never happens.

## Environment

| var | default | meaning |
|---|---|---|
| `TOKENSHAVE_DIR` | `~/.tokenshave` | where `stats.jsonl` lives (plain JSON, yours) |
| `TOKENSHAVE_COST_PER_M` | `3` | USD price per 1M input tokens, for the cost estimate |

## Roadmap

- [x] Shaving engine (v0.1, verified with real outputs — see VERIFY.md)
- [x] OpenCode plugin + `npx tokenshave install` / `uninstall` (v0.2)
- [x] Stats ledger + `tokenshave stats`
- [x] Live end-to-end verification in real agent sessions (4 scenarios, v0.4)
- [ ] Claude Code adapter (PostToolUse hook)
- [ ] Codex / Cursor adapters
- [ ] Optional bash-only toggle for users who also want shaved `read` output

## License

MIT
