# tokenshave

[English](README.md) | 简体中文

[![test](https://github.com/ljppanda/tokenshave/actions/workflows/test.yml/badge.svg)](https://github.com/ljppanda/tokenshave/actions/workflows/test.yml)

**让你的 AI 编码 agent 更快、更省钱。全自动。**

`tokenshave` 坐在你的 AI 编码 agent 和它运行的工具之间，在那些吃 token 的冗长输出（npm install 日志、测试套件、diff）进入上下文窗口**之前**把它们裁掉。

- **纯本地处理** — 不联网、不上传设备信息、无常驻进程
- **零运行时依赖** — 一个纯函数文件
- **透明** — 每一份被裁剪的输出都带有 marker 行，明确说明删掉了什么
- **可逆** — 错误、失败、摘要永远保留

## 为什么值得用

用真实捕获的输出 + 真实 BPE 分词器（GPT o200k）验证：

| 真实捕获的输出 | 原始 → 裁剪后 | 节省 | 原因 |
|---|---|---|---|
| `node --test`（61 行 TAP） | 497 → 225 tok | **55%** | 逐测试的 ok 行是噪音 |
| `git diff`，200 行文件里 28 处散改 | 3,134 → 771 tok | **75%** | 上下文行占大头 |
| `pip install`（缓存命中，17 行） | 506 → 506 tok | 0% | 正确地原样放过 |
| `npm install` 失败（ERESOLVE dump） | 282 → 282 tok | 0% | 错误输出 = 有效载荷，字节级原样保留 |

诚实说明：npm 9+ 的*成功*安装只有 ~12 行，不是痛点。节省来自测试运行器、
啰嗦的构建器、重复警告和 diff 上下文。方法论见
[VERIFY.md](VERIFY.md)。

## 状态：v0.5.0 —— OpenCode 真会话验收通过，Claude Code mod 已发布

引擎（20/20 测试）+ 统计账本 + 两个裁剪 **shell/Bash** 输出的适配器：

- **OpenCode V2 插件** —— 在真实 agent 会话（`opencode run --auto`）里跑了
  四个场景验收——安静成功、测试失败、散改 diff、藏在日志中段的关键事实
  ——每一个 agent 都回答正确，token 少了 66–79%（凭据在
  [VERIFY.md](VERIFY.md)，例如 `4,951 → 1,146 tok，精确说出失败测试名`）。
- **Claude Code mod（in-process 中间件）** —— 改写 Bash 工具结果。对照
  Claude Code 2.1.314 验收：`claude plugin validate` 通过；`claude plugin
  test` 真实 fire Bash 事件穿过 hook（228 行合成日志被裁剪，失败行与标记
  全保留）。三条安装路径全部实测：本地项目 marketplace、user 安装、远程
  GitHub marketplace。**诚实边界**：完整交互式 Claude 会话需要 API key，
  作者手上没有——所以会话级验收是 harness 判定，不是真人聊天
  （[VERIFY.md](VERIFY.md) 明确记录）。

### OpenCode 安装

```bash
cd your-project && npx tokenshave install
```

### Claude Code 安装

```text
/plugin marketplace add ljppanda/tokenshave
/plugin install tokenshave@tokenshave
```

或者项目级（不动用户全局配置，随仓库走）：

```bash
cd your-project && npx tokenshave install
claude plugin marketplace add ./.tokenshave/claude --scope project
```

只裁剪 `shell`/`Bash` 的结果——`read`/`edit` 的理解力保持原样（源码理解比
token 更重要）。

## 快速开始

```bash
cd your-agent-project
npx tokenshave install    # OpenCode：写 .opencode/plugins/tokenshave.ts
                          # Claude Code：写 .tokenshave/claude/（然后执行
                          #             claude plugin marketplace add ./.tokenshave/claude --scope project）
npm i -g tokenshave       # 把引擎放到稳定的全局位置
/reload 你的 agent 之后照常干活
npx tokenshave stats      # 看看省了多少（OpenCode 会话记账）
```

代码里用：

```ts
import { shave, record } from "tokenshave";

const raw = await runTool("npm install express");
const result = shave("npm install express", raw.output);

// 把裁剪后的文本交给 agent
await runTool(result.output);

// 记一笔省了多少
record({
  tool: "npm install express",
  rule: result.rule,
  rawLines: result.rawLines,
  keptLines: result.keptLines,
  rawTokens: result.rawTokens,
  keptTokens: result.keptTokens,
});
```

## 看看省了多少

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

## 引擎如何工作

对每一个工具输出，`shave()` 应用一条按命令分类的规则：

| 规则族 | 保留什么 |
|---|---|
| package-manager-install | 头 3 行 + 尾 8 行 + 每一条错误行 |
| test-runner | 头 4 + 尾 12，每条 `failed`/`✗`/`AssertionError` 行 |
| compiler | 头 4 + 尾 10，每条编译错误 |
| bundler-build | 头 4 + 尾 12，警告 + 错误 |
| http-client | 头部、状态码、set-cookie |
| unified diff | hunk 头和 ± 行，上下文行裁掉 |
| generic 兜底 | 头 10 + 尾 20，错误 |

小输出（低于该规则的行数预算）**原样通过**——用不上的裁剪永远不会发生。

## 环境变量

| 变量 | 默认值 | 含义 |
|---|---|---|
| `TOKENSHAVE_DIR` | `~/.tokenshave` | `stats.jsonl` 的存放位置（纯 JSON，属于你） |
| `TOKENSHAVE_COST_PER_M` | `3` | 每百万输入 token 的美元价，用于省钱估算 |

## Roadmap

- [x] 裁剪引擎（v0.1，真实输出验证——见 VERIFY.md）
- [x] OpenCode 插件 + `npx tokenshave install` / `uninstall`（v0.2）
- [x] 统计账本 + `tokenshave stats`
- [x] 真实 agent 会话中的端到端验收（4 场景，v0.4）
- [x] Claude Code 适配器：in-process mod，三条安装路径实测（v0.5）
- [ ] Claude Code 会话级判定：在真实交互会话里跑同一套 4 场景协议（卡在 API key）
- [ ] Claude mod 的统计记账（mods 禁止 import node: 模块——需要 `$.fs` 路径）
- [ ] Codex / Cursor 适配器
- [ ] 可选的"连 `read` 输出也裁"开关

## License

MIT
