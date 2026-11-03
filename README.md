# tokenshave

[![test](https://github.com/ljppanda/tokenshave/actions/workflows/test.yml/badge.svg)](https://github.com/ljppanda/tokenshave/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/tokenshave)](https://www.npmjs.com/package/tokenshave)
[![npm downloads](https://img.shields.io/npm/dw/tokenshave)](https://www.npmjs.com/package/tokenshave)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/tokenshave)](https://www.npmjs.com/package/tokenshave)

English | [简体中文](README.zh-CN.md)

Your coding agent reads tool output before it reads your code. `tokenshave` trims that output — npm log spam, wall-of-green test runs, diff context lines — before it enters the context window. Failures, summaries, and errors always survive; only filler is removed.

```
tool output (220 lines)  →  tokenshave  →  30 lines + a marker count of what was cut
```

No network. No runtime dependencies. Every trimmed output carries a marker line stating exactly what was removed, so the agent always knows it's reading shaved output.

## Install

One command wires every agent it finds relevant:

```bash
cd your-project && npx tokenshave install
```

| Agent | What gets written | Extra step |
|---|---|---|
| OpenCode | `.opencode/plugins/tokenshave.ts` | none |
| Claude Code | `.tokenshave/claude/` | `claude plugin marketplace add ./.tokenshave/claude --scope project` |
| Codex CLI | `.codex/hooks.json` | run `/hooks` once in a session to trust the hook |
| Cursor | `.cursor/hooks.json` | none (loads in trusted workspaces) |

User-scope installs, no checkout side effects:

```text
# Claude Code, inside a session
/plugin marketplace add ljppanda/tokenshave
/plugin install tokenshave@tokenshave

# Codex CLI
codex plugin marketplace add ljppanda/tokenshave
codex plugin add tokenshave@tokenshave
```

Only `shell` output is shaved. `read`/`edit` pass through untouched — source-code comprehension matters more than tokens.

## What it does

| Command family | Before it reaches the model | After |
|---|---|---|
| `npm install` etc. | dependency logs | head 3 + tail 8 + every error line |
| test runners (`vitest`, `pytest`, …) | per-test ok lines | head 4 + tail 12 + every `failed`/`✗`/`AssertionError` line |
| compilers (`tsc`, `cargo build`, …) | repeated progress noise | head 4 + tail 10 + every compile error |
| bundlers (`vite build`, `next build`, …) | warning floods | head 4 + tail 12 + warnings/errors |
| `curl` / `wget` | HTML bodies | status codes, headers |
| `git diff` | context lines | hunk headers, `+`/`-` lines |
| anything else | — | head 10 + tail 20 + error lines |

Outputs below the rule's line budget pass through byte-identical. A shave that isn't needed never happens.

## Measured

Real captured outputs, real BPE tokenizer (o200k). Full receipts in [VERIFY.md](VERIFY.md):

| Captured output | raw → shaved | saved |
|---|---|---|
| `node --test`, 61 lines of TAP | 497 → 225 tok | 55% |
| `git diff`, 28 edits in a 200-line file | 3,134 → 771 tok | 75% |
| `pip install` (cache hit, 17 lines) | 506 → 506 tok | 0% |
| `npm install` failure (ERESOLVE dump) | 282 → 282 tok | 0% |

## Library

```ts
import { shave, record } from "tokenshave";

const result = shave("npm install express", rawOutput);
// result.output — trimmed text, byte-identical when nothing needed cutting
// result.rawTokens / result.keptTokens

record({ tool: "npm install express", rule: result.rule, rawTokens: result.rawTokens, keptTokens: result.keptTokens });
```

```bash
npx tokenshave stats
```

```
tool            calls  raw tok  kept tok   saved
npm                 3    12,400     1,100     91%
────────────────────────────────────────────────
total               4    15,600     1,140     93%

≈ $0.04 saved (input @ $3/M tokens, TOKENSHAVE_COST_PER_M overrides)
```

| Env var | Default | |
|---|---|---|
| `TOKENSHAVE_DIR` | `~/.tokenshave` | where `stats.jsonl` lives |
| `TOKENSHAVE_COST_PER_M` | `3` | $/1M input tokens for the estimate |

## How each agent is wired

- **OpenCode** — an `execute.after` plugin hook that rewrites the shell tool's result object in place. Verified end-to-end: four live `opencode run --auto` scenarios, agent answered correctly every time at 66–79% fewer tokens.
- **Claude Code** — an in-process mod (`tool.call` middleware). `claude plugin validate` and `claude plugin test` pass on 2.1.314; all three marketplace install routes ran live.
- **Codex CLI** — a `PostToolUse` hook printing the documented replacement envelope (`continue:false, reason`). Contract read from the codex 0.166.0 sources; packaging ran live via `codex plugin marketplace add` / `add`.
- **Cursor** — a `preToolUse` hook rewriting whitelisted commands through the documented `updated_input` field into a wrapper that runs your command and prints its shaved output. Contract read from Cursor's hooks docs; 21-check harness in `e2e/cursor-hook-e2e.mjs`.

Every adapter fails open: if anything goes wrong, the original output goes to the model untouched. Bad stdout leaves shaving disabled, not broken.

## What's *not* verified yet

Said plainly, because verification is this project's main selling point:

- **Claude Code / Codex live sessions** — the 4-scenario protocol ran in real OpenCode sessions; for Claude and Codex it's a harness verdict because this author lacks API keys for either. The harness feeds hooks the exact wire contracts (read from sources/docs), but no model has yet read a shaved Claude/Codex transcript.
- **Cursor live session** — same situation: the wrapper was exercised in real spawned processes (exit codes, npm installs, failure-line preservation all checked), but nobody has run it inside the Cursor IDE itself.

## Roadmap

- [x] Shaving engine, verified against real outputs
- [x] OpenCode plugin + live-session acceptance (4 scenarios)
- [x] Claude Code mod, three install routes live
- [x] Codex CLI hook, contract from codex 0.166.0 sources
- [x] Cursor adapter (v0.7)
- [ ] Session-level verdicts for Claude Code / Codex / Cursor (blocked on API keys / an IDE)
- [ ] Stats ledger from the Claude mod and the Codex/Cursor hooks
- [ ] Opt-in shaving for `read` output

## License

MIT
