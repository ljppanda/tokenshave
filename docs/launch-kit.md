# launch kit —first-post drafts (2026-11-03)

首发物料。约定：**帖子里所有数字只能来自 VERIFY.md，不改地方**；
有人挖"会话级未验"就用第 5 节的应答，别现场辩解。

发布顺序建议：Reddit（英文主战场）→ X（同日串推引用 Reddit 数据）
→ HN（隔 2–3 天，等 Reddit 讨论里出现过的质疑被想清楚）→ V2EX（中文，Reddit
沉淀出 GIF 后再发，帖子里直接带图）。

---

## 1. Reddit — r/ClaudeAI（发 r/OpenAI 和 r/ChatGPTCoding 时把"Claude Code"改成对应工具名）

标题：**I measured my agent's shell output before it hit my context window — the noise was 3x the signal**

正文：

> I build with Claude Code daily, and after checking a few session logs I
> realized most of my context window was npm warnings, 200 identical test
> lines, and diff filler — not code, not errors.
>
> So I built a small thing that trims tool output before the agent reads it,
> and — this mattered to me — actually verified it instead of trusting vibes:
>
> - real agent session: 268-line CI log → the agent still named the single
>   failing test correctly, **1,985 → 264 tokens (-87%)**
> - 220-line synthetic test run through the real hook process: -85%
> - `git diff` with 28 edits in a 200-line file: 3,134 → 771 tokens
> - trailing edge cases it *correctly refuses to touch*: error dumps,
>   short outputs, cache-hit installs (0% saved, untouched — that's the point)
>
> Errors, summaries and failure names are always kept; every trimmed output
> carries a marker line saying what was removed, so the agent knows it's
> reading shaved text. Fails open: if anything breaks, the original output
> goes through untouched.
>
> Installation is one command per project; works for OpenCode, Claude Code,
> Codex CLI, and Cursor.
>
> Honest limits, upfront: the live agent-session verdict above is for
> OpenCode. For Claude Code the verification is harness-level (real hook
> process, real wire contract, but no live chat) because I don't have an API
> key to burn on the last mile. The receipts and methodology are public in
> VERIFY.md on the repo.
>
> Repo: https://github.com/ljppanda/tokenshave
> `cd your-project && npx tokenshave install`

第一条评论自己占好：贴一张"裁剪前 vs 裁剪后"的对比截图 + stats 表。

---

## 2. X / Twitter（串推，每条 ≤ 280 字符）

**1/** My agent's context window was mostly garbage — npm prepended warnings,
200 identical test lines, diff filler. I measured: 3x more noise than signal.

So I built tokenshave and actually verified the savings. Thread 🧵

**2/** The number that convinced me:

268-line CI log, one failing test buried mid-run.
Agent still named the failing test correctly.
1,985 tokens → 264 tokens. -87%.

tinyurl-receipt → repo VERIFY.md

**3/** How it works: a hook trims shell output before it enters the context.
Keeps head/tail and EVERY error line. Puts a marker line in the shaved text so
the agent knows what was cut. Fails open — worst case, original output.

**4/** Works with the four agents I actually use:
`npx tokenshave install` wires OpenCode / Claude Code / Codex CLI / Cursor
in one shot. Read/edit output is never touched.

**5/** What I refused to fake: the live chat-level verdict exists for
OpenCode. Claude/Codex/Cursor are harness-verified (real hook processes,
exact wire contracts from source/docs) because I don't have API keys for the
final mile. It's written down on the repo, not hidden.

**6/** Repo: github.com/ljppanda/tokenshave
`npx tokenshave install` and watch `tokenshave stats` after a day of work.

---

## 3. Show HN

标题：**Show HN: Tokenshave — trim AI agents' tool output before it hits the context window**

正文：

> Agents pay a token tax for the chatty side of tools: npm warnings, per-test
> ok lines, diff context, repeated progress noise. My measurements put the
> noise at 80%+ of shell-output tokens in typical runs.
>
> tokenshave is a small middleware that trims shell output before the agent
> reads it. It keeps head, tail, and every error/failure/summary line (those
> are the payload), replaces the removed middle with a marker naming what
> got cut, and passes untouched anything under the rule's line budget —
> including whole error dumps.
>
> Four adapters (OpenCode plugin, Claude Code mod, Codex CLI hook, Cursor
> hook) install with one `npx tokenshave install`.
>
> On verification: I have real-session receipts for OpenCode (4 live
> scenarios, e.g. 268-line CI log → agent still names the failing test,
> 1,985 → 264 tok). For Claude Code / Codex / Cursor the verification is
> harness-level — real hook processes fed the exact wire contracts read from
> source/docs — because I don't have API keys to spend on live chats. The
> distinction between what ran live and what didn't is written down in
> VERIFY.md rather than papered over.
>
> Fail-open by design: an error path can only mean no shaving, never a wrong
> result.
>
> Repo: https://github.com/ljppanda/tokenshave

预埋应答（ HN 评论里大概率出现的）：

- "为什么不直接跑 --quiet 调 log level？" → 答部分工具链没有统一开关（curl HTML、
  ERESOLVE dump、测试跑者输出结构各异），且 agent 会丢静默化后的关键行；
  规则表在 README，逐行可读。
- "266 行 87% 是不是挑的？" → 数据来源与全部场景（含 0% 保存的反例）在 VERIFY，
  反例不裁剪是设计而非失败。
- "为什么 Claude 会话没验？" → 诚实回答：没有 key。harness 喂的是从源码读出的
  精确契约，邀请有 key 的人跑 4 场景协议并 PR 回 VERIFY。

---

## 4. V2EX（发 /go/programmer 或 /go/nodejs，中文）

标题：**写了个 agent 工具 OUTPUT 节流阀，实测一个会话省 87% token（凭据全都公开）**

正文：

> 用 Claude Code / Cursor 这类 agent 干活一月有余，账单查看时发现大头根本不是
> 代码上下文，而是工具输出：npm 的刷屏 warning、逐条 rendered 的测试行、diff 的
> 上下文填充。我扒了自己会话日志粗算，shell 输出里 8 成以上是这类东西。
>
> 于是写了个小中间件 tokenshave：在 agent 读到 shell 输出前裁剪一次。设计原则
> 三条：
>
> 1. 报错、汇总、失败测试名永远保留（这些是 payload，不是噪音）
> 2. 裁掉的文本用一条标记行写明"删了什么"，agent 知道自己读的是裁剪版
> 3. fail-open：出错路径的后果是"不裁"而不是"裁错"，模型永不读到错误内容
>
> 实测（凭据在 repo 的 VERIFY.md，全部公开）：
>
> - 真实 agent 会话：268 行 CI 日志，agent 答对埋在正中的失败测试名，
>   1,985 → 264 tok（-87%）
> - 220 行测试输出走真实 hook 进程：-85%
> - 散改 diff（200 行文件 28 处改动）：3,134 → 771 tok
> - 诚实的反例：ERESOLVE 错误倾倒、缓存命中 pip install → 正确判定 0% 保存，
>   逐字节不动。省出来的都是该省的，不省的说明不该省。
>
> 支持四个 agent，一条命令全装好：
>
> `cd your-project && npx tokenshave install`
>
> 诚实边界先说：OpenCode 的判定是真实会话级；Claude Code / Codex / Cursor
> 目前是 harness 级（真实 hook 进程喂精确线上契约，源码/文档可查），没烧 key
> 做最后一公里。哪些真实验过、哪些没实验过，repo 里写成了独立文档。
>
> https://github.com/ljppanda/tokenshave

---

## 5. 万金油应答："你这不是只验了 OpenCode 吗？"

> 是的，live-session 判定目前只有 OpenCode（作者手上没有 Claude / OpenAI 的
> key，Cursor IDE 也没装）。其余三家是 harness 级：用从源码/文档逐行读出的
> 精确 stdin/响应契约，在真实进程里跑全链路——包括 exit code 透传、失败行
> 字节保留、垃圾输入 fail-open、sanbox 命令绝不改写这些边角。区别写在
> VERIFY.md，欢迎有 key 的人跑同一套 4 场景协议，把结果 PR 回去。

（英文版：Same, but see §3 预埋第 3 条。）

---

## 6. GitHub 仓库元数据清单（手动一次到位）

Repository → About 齿轮：
- Description: `Trim AI agents' tool output before it hits the context window — OpenCode, Claude Code, Codex CLI, Cursor. Measured, fail-open, one command.`
- Website: https://www.npmjs.com/package/tokenshave
- Topics（逐个添加）：
  `claude-code` `cursor` `codex-cli` `opencode` `token-optimization`
  `context-window` `ai-agents` `developer-tools` `npm-package`

Wishlist（做完即发布物料升一档）：
1. 动图：asciinema → GIF，内容 = 同一命令的 raw vs shaved 对比 + agent 答对失败
   测试名的会话片段（放到 README 首屏、Reddit 帖、X 串推第 2 条）
2. awesome-claude-code / cursor 插件目录 PR（登记安装路径）
