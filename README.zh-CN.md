# tokenshave

[![test](https://github.com/ljppanda/tokenshave/actions/workflows/test.yml/badge.svg)](https://github.com/ljppanda/tokenshave/actions/workflows/test.yml)

[English](README.md) | 简体中文

你的 coding agent 在读你的代码之前，先读的是工具输出。tokenshave 在这些输出进入 context window 之前把它们裁掉——npm 日志刷屏、整页绿的测试输出、diff 的上下文行。失败信息、汇总、报错永远保留，只删填充内容。

```
工具输出（220 行）  →  tokenshave  →  30 行 + 一条说明删了什么的标记行
```

无网络调用。无运行时依赖。每份裁剪输出都带一条标记行，写清删了什么——agent 永远知道自己在读裁剪后的文本。

## 安装

一条命令，装好机器上用到的所有 agent：

```bash
cd your-project && npx tokenshave install
```

| Agent | 写入内容 | 额外步骤 |
|---|---|---|
| OpenCode | `.opencode/plugins/tokenshave.ts` | 无 |
| Claude Code | `.tokenshave/claude/` | `claude plugin marketplace add ./.tokenshave/claude --scope project` |
| Codex CLI | `.codex/hooks.json` | 会话里跑一次 `/hooks` 信任 hook |
| Cursor | `.cursor/hooks.json` | 无（受信任工作区自动加载） |

用户级安装，不动仓库：

```text
# Claude Code，会话内
/plugin marketplace add ljppanda/tokenshave
/plugin install tokenshave@tokenshave

# Codex CLI
codex plugin marketplace add ljppanda/tokenshave
codex plugin add tokenshave@tokenshave
```

只裁剪 `shell` 的输出。`read`/`edit` 原样通过——源码理解比省 token 重要。

## 裁什么

| 命令家族 | 进 model 前 | 进 model 后 |
|---|---|---|
| `npm install` 等 | 依赖安装日志 | 头 3 + 尾 8 + 每条报错行 |
| 测试运行器（`vitest`、`pytest`…） | 每个 ok 测试一行 | 头 4 + 尾 12 + 每条 `failed`/`✗`/`AssertionError` 行 |
| 编译器（`tsc`、`cargo build`…） | 反复的进度刷屏 | 头 4 + 尾 10 + 每条编译错误 |
| 打包器（`vite build`、`next build`…） | 警告刷屏 | 头 4 + 尾 12 + 警告/报错 |
| `curl` / `wget` | HTML 正文 | 状态码、响应头 |
| `git diff` | 上下文行 | hunk 头、`+`/`-` 行 |
| 其他任何命令 | — | 头 10 + 尾 20 + 报错行 |

低于规则行数预算的输出逐字节原样通过。不需要裁剪的时候，一次也不会裁。

## 实测数据

真实抓取的输出 + 真实 BPE 分词器（o200k）。完整凭据见 [VERIFY.md](VERIFY.md)：

| 抓取的输出 | 原始 → 裁剪后 | 节省 |
|---|---|---|
| `node --test`，61 行 TAP | 497 → 225 tok | 55% |
| `git diff`，200 行文件里 28 处修改 | 3,134 → 771 tok | 75% |
| `pip install`（缓存命中，17 行） | 506 → 506 tok | 0% |
| `npm install` 失败（ERESOLVE 倾倒） | 282 → 282 tok | 0% |

## 库用法

```ts
import { shave, record } from "tokenshave";

const result = shave("npm install express", rawOutput);
// result.output — 裁剪后的文本；不需要裁剪时逐字节等同原文
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

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `TOKENSHAVE_DIR` | `~/.tokenshave` | `stats.jsonl` 的位置 |
| `TOKENSHAVE_COST_PER_M` | `3` | 估算用的 $/1M 输入 token |

## 各 agent 的接线方式

- **OpenCode** —— `execute.after` 插件 hook，原地改写 shell 工具的结果对象。已做端到端验收：四个真实 `opencode run --auto` 场景，agent 全部答对，token 少 66–79%。
- **Claude Code** —— in-process mod（`tool.call` 中间件）。2.1.314 上 `claude plugin validate` 和 `claude plugin test` 通过；三条 marketplace 安装路径全部实测。
- **Codex CLI** —— `PostToolUse` hook，打印文档规定的替换信封（`continue:false, reason`）。契约逐行读自 codex 0.166.0 源码；打包经 `codex plugin marketplace add` / `add` 实测。
- **Cursor** —— `preToolUse` hook，通过文档规定的 `updated_input` 字段把白名单命令改写成一个 wrapper：wrapper 跑真命令、打印裁剪后的输出。契约读自 Cursor hooks 官方文档；`e2e/cursor-hook-e2e.mjs` 21 项检查。

所有适配器 fail-open：出任何差错，原始输出原样送达 model，不会变残废。

## 哪些还没验证

直说，因为"诚实验证"是本项目的卖点：

- **Claude Code / Codex 真实会话**——4 场景协议在真实 OpenCode 会话里跑过；Claude 和 Codex 目前是 harness 判定，因为作者分别拿不到两家的 API key。harness 喂给 hook 的是从源码/文档读出的精确线上契约，但还没有任何模型读过 Claude/Codex 的裁剪后对话。
- **Cursor 真实会话**——同样情况：wrapper 在真实 spawn 进程里验证过（exit code、npm install、失败行保留都测了），但还没人在 Cursor IDE 里跑过它。

## Roadmap

- [x] 裁剪引擎，对照真实输出验证
- [x] OpenCode 插件 + 真会话验收（4 场景）
- [x] Claude Code mod，三条安装路径实测
- [x] Codex CLI hook，契约读自 codex 0.166.0 源码
- [x] Cursor 适配器（v0.7）
- [ ] Claude Code / Codex / Cursor 的会话级判定（卡 API key / 一个 IDE）
- [ ] Claude mod 与 Codex/Cursor hook 的统计记账
- [ ] `read` 输出的可选裁剪

## License

MIT
