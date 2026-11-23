---
name: gemini-ego
description: >-
  Use when a task needs the Gemini web app (gemini.google.com) through the local
  Ego browser on this Mac: ask Gemini, continue an existing Gemini conversation,
  draft or rewrite Chinese/English text, review a draft, generate viral titles,
  or generate images with Gemini. Trigger on requests like 「用 Gemini 审」,
  「出几个爆款标题」, 「让 Gemini 看看这篇」, 「浏览器里问 Gemini」, or
  "ask Gemini on the web". Always use local Ego, never a cloud browser, API, or
  Playwright. Not for WeChat MP draft publishing (use wechat-mp-draft) or
  Magpie server login repair (use magpie-gemini-login).
allowed-tools:
  - Bash
  - Read
metadata:
  version: "0.4.0"
  date: "2026-11-23"
  status: "v0.3 core live smoke passed 2026-11-23 on default /app; v0.4 adds multi-account, fail-closed auth, anti-signout guard, closeTab policy, and default Gemini 4 Neon model check (model switcher pending live DOM verify)"
---

# Gemini 网页操作（只走本机 Ego）

Gemini 网页版（`gemini.google.com`）只用本机已登录的 Ego 浏览器操作。不走云浏览器、不走 API、不走 Playwright。

先读 `ego-browser` skill（本机各 Agent 的 skills 目录下都有 `ego-browser`；不要写死某台机器的绝对路径）。按它的指引跑 `ego-browser skill`，浏览器 API 以当时输出的指南为准；本 skill 只规定 Gemini 网页版的流程、实测坑和调用约定。

固定文本提问流程在 `scripts/gemini-ask.mjs` 里（经 `ego-browser nodejs` 运行），调用方式见「怎么调脚本」。

## 总闸

- **遇到问题绝不擅自做决定（最高优先）**：遇到任何异常、缺失、冲突或不确定项（账号掉线、多账号不知用哪号、目标账号缺 Gem/Skill、`Gemini 4 Neon` 不可选或切不动、Gemini 拒审、页面卡住、粘贴校验失败等），**立即停手，绝不静默降级或替用户拍板**；必须清楚告知用户当前发生了什么，并给出带明确**「（推荐）」**标记的备选方案，等用户确认后再继续。
- **只操作 Gemini 网页版**：不借这个 skill 登录其他站点、不发布任何内容。其他平台走各自 skill（公众号草稿走 `wechat-mp-draft`，X 发布走 `x-ego-send`，Magpie 服务端登录态排障走 `magpie-gemini-login`）。
- **单空间、复页面，不堆 tab**：同一个目标复用同一个 `taskSpace` 和同一个 Gemini 对话页（按运行期 `page.label` 保留），**绝不**新开第二个 `taskSpace` 去绕开卡住的页面，也不要为每篇文章各自挂一堆常驻 tab。
- **一篇一对话（1:1 强绑定，严禁串稿）**：
  - **同篇不换**：同一篇文章（同一母题，含起草、改稿、标题、配图及同篇多平台衍生短帖）全部绑定到同一个 `<文章目录>/gemini-session.json`（通过 `sessionFile` 自动管理 `spaceId`、`convUrl` 与 `accountPrefix`）。
  - **换篇必新**：开始另一篇文章必须使用新目录的 `sessionFile`（或显式 `newChat: true`），**绝不把两篇不同文章混进同一个对话**。
  - **引用旧文走显式注入**：新文章需要衔接旧文时，新开对话并在首轮通过 `promptFile` / `contextFiles` 传入相关旧文的**定稿摘要或全文**，不要切回旧文章的聊天窗。
  - **终审建议独立**：改稿后的最终审查建议单独开审或显式带最新规范审，避免同对话顺拐偏差。
- **强登录态 + 严禁匿名弱模型凑合**：Gemini 未登录/掉线时虽然也能在输入框发问，但会静默降级到低配基础模型且无法保存会话。脚本采用 **fail-closed 强校验**——必须真实检测到已登录的 Google 账号控件且无「Sign in / 登录」入口，否则一律判定掉线，**立即 `task.handOff()` 交给用户重登**，绝不凑合发问。
- **防误触红线（严禁碰登录/退出控件）**：**严禁点击**右上角 Google 账号头像、账号切换浮层、以及任何含「退出登录 / 取消登录 / 保持登出 / 注销 / 切换账号 / Sign out / Log out / Stay signed out / Cancel sign in」的按钮或弹窗。账号核对只读 DOM 属性，不点开菜单；遇到登录弹窗直接 `task.handOff()`。**回复、日志和报错里绝不输出账号邮箱。**
- **默认模型：`Gemini 4 Neon`**：提问模式默认校验并优先使用 **`Gemini 4 Neon`**（`model: "Gemini 4 Neon"`, `strictModel: true`）。切不到或当前账号无此模型时停手报给用户并给推荐方案，**绝不静默用差模型硬写**。
- **不污染仓库、不放密钥**：skill 目录只放代码和说明；prompt、回答、草稿、`gemini-session.json`、生成图片一律存到调用方任务目录的绝对路径（且 `gemini-session.json` 与 `*.debug.txt` 不要提交进 Git）。脚本和 prompt 中绝不放 token、密码、密钥。

## 账号、首次使用、Tab 关闭与模型规范

### 1. 多 Gemini 账号怎么处理
- Ego 浏览器可能同时登录多个 Google 账号（`/app` 即 `/u/0`，其余为 `/u/1/app`、`/u/2/app` 等）。
- **只通过 URL 槽位切换**：调用方指定 `accountIndex`（如 `1`）或完整 `convUrl`/`startUrl`（含 `/u/1/`）直接导航切换，**严禁点击右上角账号头像菜单去切换账号**（防误触退出登录）。
- **锁定不漂移**：`sessionFile` 会自动记录 `accountPrefix`，后续续轮与 `newChat: true` 自动沿用同一账号槽位；如果浏览器有多个账号且调用方未明确指定该用哪一个、或 `expectedAccount` 核对不匹配 → **停手告知用户**，不要猜。

### 2. 首次使用一个新账号、里面没有对应 Gemini Skill / Gem 怎么办
- **优先不依赖网页版 Skill / Gem**：我们的写作语料唯一真源在 GitHub `pancras-writing-corpus`（`main`），本机拼装后首轮直接走 `promptFile` / `contextFiles` 注入——**任何新登录的 Gemini 账号直接开普通 `/app`（或 `/u/<n>/app`）即可开箱即用，无需预先在账号里建 Skill 或 Gem**。
- **若显式指定了 `/gem/<id>` 但新账号里没有**：脚本检测到跳转到 `/app` 或找不到目标 Gem 时会直接报错停止（绝不静默降级发进普通对话）。此时按「遇到问题怎么回报」告知用户：
  - **方案 A（推荐）**：改走普通 `/app`（或 `/u/<n>/app`），由本地拼装器把语料直接首轮注入 `promptFile`，零迁移成本且 100% 实时 SSOT；
  - **方案 B**：本地跑 `build-writing-context.mjs --export-gemini-skill` 导出包，再用 `task.handOff()` 请用户手动上传到该新账号的 Gemini Skills，传完后再用新的 `startUrl` 重跑。

### 3. Ego 浏览器每次用完要不要关闭当前 tab？
分场景处理（由 `finish` + `closeTab` 两个开关精确控制，**不要为多篇文章各自堆一堆常驻 tab**）：

| 场景 | 推荐参数 | 实际行为与原因 |
|---|---|---|
| **写同一篇文章（进行中，后面还要改稿/审稿/标题/生图）** | `finish: true, closeTab: false`（**默认**） | `task.finish({ keep: [pageLabel] })` 保留这 **1 个**对话 tab，续轮免重载且方便用户随时在 Ego 查看；换写另一篇文章时复用同一个 tab 自动 `goto` 切到另一篇的 `convUrl`，不堆页 |
| **同一次 Agent 回复内后面还有浏览器步骤（如生图后立刻下载）** | `finish: false` | 暂不结束 space，保留活的 `page` label；等本轮全部浏览器操作做完后再单独调 `task.finish(...)` |
| **一次性零碎提问，或整篇文章已彻底定稿收尾** | `finish: true, closeTab: true` | `task.finish({ keep: [] })` 关闭 tab 与 space 释放资源；脚本会把 `sessionFile.spaceId` 清为 `null` 但**完整保留 `convUrl` 与 `accountPrefix`**，以后任何时候拿同一 `sessionFile` 回来仍可自动建新 space 100% 无损续回原对话 |
| **出错、超时或 `task.handOff()`** | 自动处理 | **绝不调用 `finish()`、绝不关 tab**，保住现场供排查或用户接管 |

### 4. Gemini 账号掉线（登录掉了）怎么办
- 未登录的 Gemini 虽然仍能输入，但模型被大幅降级且不能持久化会话。
- 脚本检测到登录墙、存在「Sign in / 登录」控件、或缺少已登录 Google 账号头像控件时，会**拒绝发问并立即 `task.handOff()`**。
- Agent 收到 `handOff: true` 后：停手告知用户「当前 Ego 里的 Gemini 账号已掉线（未登录状态会被降级到低配模型，已中止发送）」，给出推荐方案：
  - **方案 A（推荐）**：请你在 Ego 浏览器当前页重新登录目标 Google 账号，登好后告诉我，我用同一个 `sessionFile` 接着跑；
  - **方案 B**：如果你要临时切到 Ego 里已登录的另一个槽位账号（如 `/u/1`），告诉我槽位编号即可。

### 5. 防止误触「取消登录」「退出登录」
- **代码硬防线**：`gemini-ask.mjs` 在执行任何 DOM `.click()`（发送按钮、模型切换器、模型下拉项）前，均会校验元素及其祖先的 `aria-label`、`title`、`innerText`、`href`，一旦命中 `Sign out / Log out / Stay signed out / Cancel sign in / Switch account / 退出登录 / 取消登录 / 保持登出 / 注销 / 切换账号` 或位于 Google Account 头部区域，直接拒绝点击。
- **操作硬防线**：手写一次性 Ego 补充脚本时同样严禁点击账号头像和任何登录/登出确认弹窗；不确定按钮是什么一律先 `snapshot()`，遇到账号类弹窗立刻 `task.handOff()`。

### 6. 默认模型：`Gemini 4 Neon`
- `gemini-ask.mjs` 在提问模式默认检查并尝试切换到 **`Gemini 4 Neon`**（`model: "Gemini 4 Neon"`, `strictModel: true`）。
- 切换前先读当前模型名；已匹配则不点任何菜单；不匹配时只点击输入区/模式切换器内通过安全检查的模型按钮并选中目标项，随后二次复核。
- 若当前账号无 `Gemini 4 Neon`、或界面改版导致模型切换器无法确认（且 `strictModel: true`）：脚本按 `Escape` 收起菜单并报错停止，**绝不凑合用其他模型硬写**；Agent 将报错里读到的 `currentModel` 与 `availableModels` 告知用户并给出推荐方案（如：推荐请用户在 Ego 里切好 `Gemini 4 Neon` 后继续，或经用户明确同意后再改传 `model: "<其他模型>"` / `strictModel: false`）。

## 遇到问题怎么回报（标准格式）

任何失败、阻塞或需要拍板的场景，Agent 必须遵守：
1. **先停手**：不盲目重试、不静默降级、不替用户做决定；
2. **一句话说清现状**：发生了什么（例如：掉线 / 错号 / 缺 `Gemini 4 Neon` / 缺 Gem / Gemini 拒审 / 超时）；
3. **给出 2–3 个清晰选项，第一项标「（推荐）」并写明理由**；
4. **等用户回复后再继续**。

## Gemini 网页实测坑（别换方法）

以下规则来自 live Gemini 实测，违反会直接把页面和后续 `taskSpace` 卡死：

1. **输入框 `.ql-editor` 的禁区**：
   - **禁止**对 `.ql-editor` 调用 `page.click()` 或 `page.fill()`：页面永远不 idle，调用会挂到超时并波及后续 space。
   - **禁止**一次 `document.execCommand("insertText", ...)` 塞整篇长文：页面会假死，之后连 `taskSpace()` 都进不去（若误触发，不要连开新 space 去绕）。
2. **已验证可用的输入与发送顺序**：
   1. 用 `page.evaluate()` 聚焦 `.ql-editor`；若有短残留文本，先用 `Range` 把选区限定在 `.ql-editor` 内再删除（超过 2000 字长残留直接 `handOff()` 给用户清理）。
   2. 用 `page.keyboard.paste(全文)` 一次贴完，轮询等待 `.ql-editor` 内容稳定（最长 4 秒），读取 `innerText`（规整 `&nbsp;` 后）核对首尾一致再发；单次总长度受 `maxPromptChars`（默认 30000）保护，防止 Gemini 把超长粘贴自动折叠成 `pasted.txt` 附件。
   3. 在输入区容器内精确查找发送按钮 `aria-label="Send message"`（中文兼容 `发送消息` / `傳送訊息`，且必须通过防误触安全校验）；点击后确认输入区清空或生成启动，再等待状态指示与停止按钮消失且最新回复节点稳定。
3. **`page.goto` 假超时**：`page.goto` 15 秒超时但当前 URL 已经到达目标 `/app` 或 `/gem/<id>`（含 `/u/<n>`）且 `document.readyState` 为 `interactive` 或 `complete` 时，停在这一页继续操作，不要重试新开 space；若仍停留在旧会话未跳转，按超时报错处理，绝不把问题发进旧对话。
4. **`&nbsp;` 空白差异**：Gemini 回复中的空格常为 `&nbsp;`（`\u00a0`），核对和提取一律使用 `innerText` 并将 `\u00a0` 归一化为普通空格，不要用 HTML 原文做字面匹配。

## 怎么调脚本

脚本路径：`scripts/gemini-ask.mjs`，通过 `ego-browser nodejs` 运行。脚本不读 shell 环境变量、不认相对路径，所有文件路径必须是**绝对路径**。

### SSOT 语料同步约定（若使用外部 Git 语料仓）

`ego-browser nodejs` 不继承 shell 环境变量（SSH key / 代理不可用），因此任何 Git 同步**必须在调用脚本前的 Shell 里完成**：
1. 开新文章第 1 轮前，先在 Shell 对语料仓执行 `GIT_TERMINAL_PROMPT=0 git -C <corpus-dir> pull --ff-only origin main`；
2. 若使用拼装脚本产出已内嵌语料的 `promptFile`（带 `<!-- CORPUS_CONTEXT_EMBEDDED -->` 标记），**不要**同时传 `contextFiles`（脚本会直接报错防止双倍注入）；
3. 若不使用外部拼装器，可直接把背景文件绝对路径传给 `contextFiles`（仅新对话首轮自动拼装，续轮自动跳过并做 SHA-256 变更检测）。

### 输入字段

| 字段 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `prompt` / `promptFile` | 二选一（都空=只取回答） | `""` | 不能同时非空。短提问可直接填 `prompt`；**含引号/换行或长文本一律写文件后传 `promptFile` 绝对路径** |
| `sessionFile` | 强烈推荐 | `""` | `<文章目录>/gemini-session.json` 绝对路径；不存在时自动新开对话并原子落盘，已存在时自动续回本文 `convUrl`、`spaceId` 与 `accountPrefix` |
| `convUrl` | 否 | `""` | 不使用 `sessionFile` 时显式传入要续的对话 URL（与 `sessionFile` 互斥）；无 `sessionFile` 的提问模式必须显式传 `convUrl` 或 `newChat: true` |
| `startUrl` | 否 | `""` | 仅新开对话时可用，指定入口页（默认 `/app` 或继承 `/u/<n>/app`，也兼容 `/gem/<id>`） |
| `newChat` | 否 | `false` | `true` = 强制开全新对话（若配了 `sessionFile`，旧 `convUrl` 会归档进 `previousUrls`） |
| `forceSend` | 否 | `false` | 上次发送处于 `pending_response` 时脚本默认拒发以防重发；确认要覆盖才设 `true` |
| `contextFiles` | 否 | `[]` | 背景文件绝对路径数组；新对话首轮自动按块拼在 `prompt` 前面并记 SHA-256，续轮需配合 `sessionFile` 做变更检测 |
| `onContextChange` | 否 | `"warn"` | 续轮检测到 `contextFiles` 内容变化时的策略：`"warn"` / `"reinject"` / `"error"` |
| `maxPromptChars` | 否 | `30000` | 单次粘贴字符数上限，防止超长文本被 Gemini 转附件导致校验失败 |
| `accountIndex` | 否 | `null` | 多账号槽位（非负整数：`0` → `/app`，`1` → `/u/1/app`）；与 `convUrl`/`startUrl`/`sessionFile` 冲突时报错 |
| `expectedAccount` | 否 | `""` | 可选账号核对子串（脚本绝不会将其打印到输出或报错中） |
| `model` | 否 | `"Gemini 4 Neon"` | 期望使用的 Gemini 模型名；传 `""` 跳过模型检查 |
| `strictModel` | 否 | `true` | `true` = 目标模型无法确认或切换失败时立即报错停止，绝不静默降级 |
| `spaceId` | 否 | `null` | 手动指定整数 `spaceId`（传了 `sessionFile` 时自动读取，无需手填） |
| `spaceName` | 否 | `"gemini-web"` | 新建 space 时的名称（撞名时脚本自动加后缀） |
| `outFile` | **是** | `""` | 回答写入的绝对路径（自动建父目录；同时输出脱敏后的 `outFile.debug.txt`） |
| `finish` | 否 | `true` | `true` = 成功后调用 `task.finish(...)`；同轮回复后面还有浏览器步骤（如接着下载生图）时设 `false` |
| `closeTab` | 否 | `false` | 仅在 `finish: true` 时生效：`false` 保留当前对话 tab（`keep: [pageLabel]`）；`true` 关闭 tab 与 space（`keep: []`），并保留 `sessionFile.convUrl` 供日后续回 |

### 推荐跑法（无需手抄整份脚本）

用 `node` 生成安全的 JSON 输入头部，拼接 `scripts/gemini-ask.mjs` 管道给 `ego-browser nodejs`（把 `<SKILL_DIR>` 换成本 skill 绝对路径；若短 `prompt` 含英文单引号，请改用 `promptFile`）：

```bash
{
  node -e 'console.log("globalThis.__GEMINI_INPUT__ = " + JSON.stringify({
    promptFile: "/abs/path/to/article/prompt.txt",
    sessionFile: "/abs/path/to/article/gemini-session.json",
    accountIndex: null,
    expectedAccount: "",
    model: "Gemini 4 Neon",
    strictModel: true,
    outFile: "/abs/path/to/article/response.txt",
    finish: true,
    closeTab: false
  }) + ";");'
  cat "<SKILL_DIR>/scripts/gemini-ask.mjs"
} | ego-browser nodejs
```

若沙箱限制管道，也可将 `scripts/gemini-ask.mjs` 填入 `DEFAULT_INPUT` 后通过 `ego-browser nodejs <<'EOF' ... EOF` 运行。

### 输出、两阶段落盘与恢复

脚本 stdout 只输出**单段 JSON**：

```json
{
  "ok": true,
  "spaceId": 7,
  "page": null,
  "finished": true,
  "tabClosed": false,
  "url": "https://gemini.google.com/app/xxxxxxxx",
  "model": "Gemini 4 Neon",
  "modelSwitched": false,
  "responseFile": "/abs/path/to/response.txt",
  "sessionFile": "/abs/path/to/article/gemini-session.json",
  "extractionMode": "model_response",
  "contextChanged": false,
  "changedFiles": []
}
```

- **两阶段原子落盘与防重发**：使用 `sessionFile` 时，脚本在**发送生效后立即**写入 `status: "pending_response"`（并在轮询检测到 `/app/<id>` 时立即更新 `convUrl`），回答完成后才更新为 `status: "ready"`。若中途超时（180s）或 `handOff`，再次带 `prompt` 调用会被防重发锁拦住——此时应把 `prompt` 和 `promptFile` 留空走 **只取回答模式（extract-only）** 无损取回答案，不会刷新页面也不会重复发问。
- **关于 `page`、`finished` 与 `tabClosed`**：按 `ego-browser` 规范，`finish()` 会作废所有 Page label（含保留页）。因此 `finished: true` 时脚本返回 `page: null`；若同时 `closeTab: true`，`tabClosed` 为 `true` 且 `spaceId` 归为 `null`（下次用同一 `sessionFile` 自动建新 space 回到原 `convUrl`）。只有 `finish: false` 时 `page` 才返回本轮仍有效的 label。
- **异常与 `handOff`**：任何一步失败都会停止，输出统一结构 `{ ok: false, error, handOff, spaceId, page, url, ... }`（不含原始 snapshot 与账号邮箱；脱敏诊断写入 `outFile.debug.txt`），且**不调用 `task.finish()`、不关闭当前 tab**。

## 常见任务与问法经验

- **起草 / 改稿**：草稿与回答一律写入调用方任务目录的绝对路径。**仅当**调用方显式提供了写作规范/语料文件时按其自查；未提供时不私自套用特定项目的格式限制。
- **审稿**：把稿件 + 审查清单发给 Gemini 拿编号意见。**实测坑**：整篇丢进去要求「审稿 / 别改事实 / 合规」时，Gemini 经常拒答（「我只是一个文本 AI，在这方面没法帮到你」），这不是没发出去。若被拒审，必须如实回报「没审过」并给推荐方案，**绝不把标题列表或泛泛回复当成审稿通过**。
- **爆款标题**：在同一对话里单独要，措辞用「只做文字编辑，给 N 个标题」成功率更高。标题由调用方挑，agent 不代挑。
- **事实把关**：Gemini 容易把「免费」「所有 Agent」等表述说满；回写稿件前删掉未经实测的夸大内容，事实以用户原稿、代码和官方文档为准。
- **生成图片**：
  - 在同一对话里让 Gemini 生图（若同轮还要继续下载图片，提问脚本可传 `finish: false`，下载完成后再统一 `task.finish({ keep: [pageLabel] })`）。
  - **下载方式**：Gemini 图片 CDN 通常跨域，`page.fetch()` 受浏览器 CORS 限制容易失败；按 `ego-browser` 规范，**先挂 `const downloadPromise = page.waitForEvent("download", { timeout: 30_000 })`，再点击图片上的下载按钮**，最后 `await (await downloadPromise).saveAs("/abs/path/image.png")` 直接存到调用方任务目录。
  - 不要存进 `~/Downloads`，也不要存进 skill 目录。

## 首次 live 脚本烟测清单

1. ✅（2026-11-23 默认 `/app` 通过）账号与登录态识别、`.ql-editor` 聚焦粘贴首尾核对、`Send message` 发送、`model_response` 提取、`sessionFile` 续轮、`extract-only`、`newChat`；
2. 待实测：多账号 `accountIndex`（`/u/1/app`）切换与 `sessionFile.accountPrefix` 锁定；
3. 待实测：`/gem/<id>` 入口在缺失账号上的报错拦截；
4. 待实测：匿名/掉线态（无账号头像但 `.ql-editor` 仍可见）是否稳定触发 `handOff` 拒绝发送；
5. 待实测：模型切换器 DOM 与默认 **`Gemini 4 Neon`** 自动校验/切换（若页面文案或选择器有差异，按 live DOM 校准）；
6. 待实测：`closeTab: true` 关闭 tab 后用同一 `sessionFile` 无损续回原对话；
7. 待实测：触发自动转 `pasted.txt` 附件的真实字符阈值，按实测校准 `maxPromptChars`。

## 不要做

- **不要遇到问题自己做决定**：必须停手告知用户，并附上带推荐标记的方案。
- 不要用云浏览器、API、Playwright 顶替 Ego 操作 Gemini 网页版。
- 不要在未登录/掉线匿名态凑合发问，也不要在目标模型（默认 `Gemini 4 Neon`）不可用时静默降级。
- **严禁点击** Google 账号头像、账号切换菜单，以及任何「退出登录」「取消登录」「保持登出」「Sign out」「Cancel sign in」按钮。
- 不要对 `.ql-editor` 用 `page.click()`、`page.fill()` 或对长文用 `execCommand("insertText")`。
- 不要新开第二个 `taskSpace`，不要为每篇文章堆常驻 tab，也不要把两篇不同文章混进同一个 Gemini 对话。
- 不要在回复、日志或报错里输出账号邮箱、token、密码、密钥。
- 不要把 prompt、回答、稿子、图片写进 skill 目录或 `~/Downloads`，也不要把 `gemini-session.json` / `*.debug.txt` 提交进 Git。
- 不要替调用方挑标题、定稿子、点发布，也不要把 Gemini 拒审包装成已审过。
