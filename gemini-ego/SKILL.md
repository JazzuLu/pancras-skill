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
  version: "0.3.0"
  date: "2026-11-23"
  status: "merged ego-gemini-assist live pitfalls + sessionFile/contextFiles; pending live smoke test"
---

# Gemini 网页操作（只走本机 Ego）

Gemini 网页版（`gemini.google.com`）只用本机已登录的 Ego 浏览器操作。不走云浏览器、不走 API、不走 Playwright。

先读 `ego-browser` skill（本机各 Agent 的 skills 目录下都有 `ego-browser`；不要写死某台机器的绝对路径）。按它的指引跑 `ego-browser skill`，浏览器 API 以当时输出的指南为准；本 skill 只规定 Gemini 网页版的流程、实测坑和调用约定。

固定文本提问流程在 `scripts/gemini-ask.mjs` 里（经 `ego-browser nodejs` 运行），调用方式见「怎么调脚本」。

## 总闸

- **只操作 Gemini 网页版**：不借这个 skill 登录其他站点、不发布任何内容。其他平台走各自 skill（公众号草稿走 `wechat-mp-draft`，X 发布走 `x-ego-send`，Magpie 服务端登录态排障走 `magpie-gemini-login`）。
- **单空间、复页面**：同一个目标始终复用同一个 `taskSpace` 和对话页（按运行期 `page.label` 保留）。**绝不**新开第二个 `taskSpace` 去绕开卡住的页面。
- **一篇一对话（1:1 强绑定，严禁串稿）**：
  - **同篇不换**：同一篇文章（同一母题，含起草、改稿、标题、配图及同篇多平台衍生短帖）全部绑定到同一个 `<文章目录>/gemini-session.json`（通过 `sessionFile` 自动管理 `spaceId` 与 `convUrl`）。
  - **换篇必新**：开始另一篇文章必须使用新目录的 `sessionFile`（或显式 `newChat: true`），**绝不把两篇不同文章混进同一个对话**。
  - **引用旧文走显式注入**：新文章需要衔接旧文时，新开对话并在首轮通过 `promptFile` / `contextFiles` 传入相关旧文的**定稿摘要或全文**，不要切回旧文章的聊天窗。
  - **终审建议独立**：改稿后的最终审查建议单独开审或显式带最新规范审，避免同对话顺拐偏差。
- **先核对登录态与账号**：
  - 本机 Ego 默认已登录 Pro 账号。注意多账号 URL 差异（默认 `/app` 为 `/u/0`，切账号为 `/u/1/app` 等），切错号会静默降级模型；`newChat: true` 未传 `startUrl` 时脚本自动继承 `sessionFile` 的 `/u/<n>` 前缀。
  - 若调用方指定了 `expectedAccount`，动手前核对页面登录账号；未登录、错号、登录墙、密码、扫码、2FA、验证码一律停手，不输密码、不清 cookie，用 `task.handOff()` 交给用户。
  - **回复、日志和报错里不要输出账号邮箱。**
- **不污染仓库、不放密钥**：skill 目录只放代码和说明；prompt、回答、草稿、`gemini-session.json`、生成图片一律存到调用方任务目录的绝对路径（且 `gemini-session.json` 与 `*.debug.txt` 不要提交进 Git）。脚本和 prompt 中绝不放 token、密码、密钥。

## Gemini 网页实测坑（别换方法）

以下规则来自 live Gemini 实测，违反会直接把页面和后续 `taskSpace` 卡死：

1. **输入框 `.ql-editor` 的禁区**：
   - **禁止**对 `.ql-editor` 调用 `page.click()` 或 `page.fill()`：页面永远不 idle，调用会挂到超时并波及后续 space。
   - **禁止**一次 `document.execCommand("insertText", ...)` 塞整篇长文：页面会假死，之后连 `taskSpace()` 都进不去（若误触发，不要连开新 space 去绕）。
2. **已验证可用的输入与发送顺序**：
   1. 用 `page.evaluate()` 聚焦 `.ql-editor`；若有短残留文本，先用 `Range` 把选区限定在 `.ql-editor` 内再删除（超过 2000 字长残留直接 `handOff()` 给用户清理）。
   2. 用 `page.keyboard.paste(全文)` 一次贴完，轮询等待 `.ql-editor` 内容稳定（最长 4 秒），读取 `innerText`（规整 `&nbsp;` 后）核对首尾一致再发；单次总长度受 `maxPromptChars`（默认 30000）保护，防止 Gemini 把超长粘贴自动折叠成 `pasted.txt` 附件。
   3. 在输入区容器内精确查找发送按钮 `aria-label="Send message"`（中文兼容 `发送消息` / `傳送訊息`，避免误点「发送反馈」）；点击后确认输入区清空或生成启动，再等待状态指示与停止按钮消失且最新回复节点稳定。
3. **`page.goto` 假超时**：`page.goto` 15 秒超时但当前 URL 已经到达目标 `/app` 或 `/gem/<id>`（含 `/u/<n>`）且 `document.readyState` 为 `interactive` 或 `complete` 时，停在这一页继续操作，不要重试新开 space；若仍停留在旧会话未跳转，按超时报错处理，绝不把问题发进旧对话。
4. **`&nbsp;` 空白差异**：Gemini 回复中的空格常为 `&nbsp;`（`\u00a0`），核对和提取一律使用 `innerText` 并将 `\u00a0` 归一化为普通空格，不要用 HTML 原文做字面匹配。

## 怎么调脚本

脚本路径：`scripts/gemini-ask.mjs`，通过 `ego-browser nodejs` 运行。脚本不读 shell 环境变量、不认相对路径，所有文件路径必须是**绝对路径**。

### SSOT 语料同步约定（若使用外部 Git 语料仓）

`ego-browser nodejs` 不继承 shell 环境变量（SSH key / 代理不可用），因此任何 Git 同步**必须在调用脚本前的 Shell 里完成**：
1. 开新文章第 1 轮前，先在 Shell 对你的语料仓执行 `GIT_TERMINAL_PROMPT=0 git -C <corpus-dir> pull --ff-only origin main`；
2. 若使用拼装脚本产出已内嵌语料的 `promptFile`（带 `<!-- CORPUS_CONTEXT_EMBEDDED -->` 标记），**不要**同时传 `contextFiles`（脚本会直接报错防止双倍注入）；
3. 若不使用外部拼装器，可直接把背景文件绝对路径传给 `contextFiles`（仅新对话首轮自动拼装，续轮自动跳过并做 SHA-256 变更检测）。

### 输入字段

| 字段 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `prompt` / `promptFile` | 二选一（都空=只取回答） | `""` | 不能同时非空。短提问可直接填 `prompt`；**含引号/换行或长文本一律写文件后传 `promptFile` 绝对路径** |
| `sessionFile` | 强烈推荐 | `""` | `<文章目录>/gemini-session.json` 绝对路径；不存在时自动新开对话并原子落盘，已存在时自动续回本文 `convUrl` 与 `spaceId` |
| `convUrl` | 否 | `""` | 不使用 `sessionFile` 时显式传入要续的对话 URL（与 `sessionFile` 互斥）；无 `sessionFile` 的提问模式必须显式传 `convUrl` 或 `newChat: true` |
| `startUrl` | 否 | `""` | 仅新开对话时可用，指定入口页（默认 `/app` 或继承 `/u/<n>/app`，也兼容 `/gem/<id>`） |
| `newChat` | 否 | `false` | `true` = 强制开全新对话（若配了 `sessionFile`，旧 `convUrl` 会归档进 `previousUrls`） |
| `forceSend` | 否 | `false` | 上次发送处于 `pending_response` 时脚本默认拒发以防重发；确认要覆盖才设 `true` |
| `contextFiles` | 否 | `[]` | 背景文件绝对路径数组；新对话首轮自动按块拼在 `prompt` 前面并记 SHA-256，续轮跳过 |
| `onContextChange` | 否 | `"warn"` | 续轮检测到 `contextFiles` 内容变化时的策略：`"warn"`（仅在输出标记） / `"reinject"`（增量补发变动文件） / `"error"` |
| `maxPromptChars` | 否 | `30000` | 单次粘贴字符数上限，防止超长文本被 Gemini 转附件导致校验失败 |
| `spaceId` | 否 | `null` | 手动指定整数 `spaceId`（传了 `sessionFile` 时自动读取，无需手填） |
| `spaceName` | 否 | `"gemini-web"` | 新建 space 时的名称（撞名时脚本自动加后缀） |
| `expectedAccount` | 否 | `""` | 可选账号核对子串（脚本绝不会将其打印到输出或报错中） |
| `outFile` | **是** | `""` | 回答写入的绝对路径（自动建父目录；同时输出脱敏后的 `outFile.debug.txt`） |
| `finish` | 否 | `true` | `true` = 成功后自动 `task.finish({ keep: [pageLabel] })`；同轮回复后面还有浏览器步骤（如接着下载生图）时设 `false`，待本轮结束后再单独 `finish` |

### 推荐跑法（无需手抄整份脚本）

用 `node` 生成安全的 JSON 输入头部，拼接 `scripts/gemini-ask.mjs` 管道给 `ego-browser nodejs`（把 `<SKILL_DIR>` 换成本 skill 绝对路径；若短 `prompt` 含英文单引号，请改用 `promptFile`）：

```bash
{
  node -e 'console.log("globalThis.__GEMINI_INPUT__ = " + JSON.stringify({
    promptFile: "/abs/path/to/article/prompt.txt",
    sessionFile: "/abs/path/to/article/gemini-session.json",
    contextFiles: [],
    expectedAccount: "",
    outFile: "/abs/path/to/article/response.txt",
    finish: true
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
  "url": "https://gemini.google.com/app/xxxxxxxx",
  "responseFile": "/abs/path/to/response.txt",
  "sessionFile": "/abs/path/to/article/gemini-session.json",
  "extractionMode": "model_response",
  "contextChanged": false,
  "changedFiles": []
}
```

- **两阶段原子落盘与防重发**：使用 `sessionFile` 时，脚本在**发送生效后立即**写入 `status: "pending_response"`（并在轮询检测到 `/app/<id>` 时立即更新 `convUrl`），回答完成后才更新为 `status: "ready"`。若中途超时（180s）或 `handOff`，再次带 `prompt` 调用会被防重发锁拦住——此时应把 `prompt` 和 `promptFile` 留空走 **只取回答模式（extract-only）** 无损取回答案，不会刷新页面也不会重复发问。
- **关于 `page` 与 `finished`**：按 `ego-browser` 规范，`finish()` 会作废所有 Page label（含保留页）。因此 `finished: true` 时脚本返回 `page: null`（下一轮由 `sessionFile` 自动 `claimTaskSpace` + `adopt`）；只有 `finish: false` 时 `page` 才返回本轮仍有效的 label。
- **异常与 `handOff`**：任何一步失败都会停止，输出统一结构 `{ ok: false, error, handOff, spaceId, page, url, ... }`（不含原始 snapshot 与账号邮箱；脱敏诊断写入 `outFile.debug.txt`），且**不调用 `task.finish()`**。
- **`extractionMode` 检查**：正常应为 `"model_response"`；若降级为 `"fallback_body"`，需结合 `outFile.debug.txt` 核对并更新脚本选择器。

## 常见任务与问法经验

- **起草 / 改稿**：草稿与回答一律写入调用方任务目录的绝对路径。**仅当**调用方显式提供了写作规范/语料文件时按其自查；未提供时不私自套用特定项目的格式限制。
- **审稿**：把稿件 + 审查清单发给 Gemini 拿编号意见。**实测坑**：整篇丢进去要求「审稿 / 别改事实 / 合规」时，Gemini 经常拒答（「我只是一个文本 AI，在这方面没法帮到你」），这不是没发出去。若被拒审，必须如实回报「没审过」，**绝不把标题列表或泛泛回复当成审稿通过**。
- **爆款标题**：在同一对话里单独要，措辞用「只做文字编辑，给 N 个标题」成功率更高。标题由调用方挑，agent 不代挑。
- **事实把关**：Gemini 容易把「免费」「所有 Agent」等表述说满；回写稿件前删掉未经实测的夸大内容，事实以用户原稿、代码和官方文档为准。
- **生成图片**：
  - 在同一对话里让 Gemini 生图（若同轮还要继续下载图片，提问脚本可传 `finish: false`，下载完成后再统一 `task.finish({ keep: [pageLabel] })`）。
  - **下载方式**：Gemini 图片 CDN 通常跨域，`page.fetch()` 受浏览器 CORS 限制容易失败；按 `ego-browser` 规范，**先挂 `const downloadPromise = page.waitForEvent("download", { timeout: 30_000 })`，再点击图片上的下载按钮**，最后 `await (await downloadPromise).saveAs("/abs/path/image.png")` 直接存到调用方任务目录。
  - 不要存进 `~/Downloads`，也不要存进 skill 目录。

## 首次 live 脚本烟测清单

`scripts/gemini-ask.mjs` 首次在 live Gemini 上跑通时，核对以下 9 项，通过后把 `metadata.status` 改为已验证并更新日期：

1. 账号按钮选择器能正确识别当前已登录状态（不误触发 `handOff`）；
2. `.ql-editor` 聚焦 + `keyboard.paste` 稳定轮询与首尾核对通过；
3. `aria-label="Send message"`（或中文按钮）触发发送后，输入区清空且生成开始；
4. 状态指示 / 停止按钮判定能扛住 Thinking 阶段不早退，且回复正文未混入 `model-thoughts`；
5. 返回的 `extractionMode` 为 `"model_response"` 且 `url` 已更新为 `/app/<id>`；
6. 传 `sessionFile` 自动建新对话并落盘，第二轮同 `sessionFile` 自动续轮，以及空 prompt extract-only 不重载取回答均通过；
7. 已有 `/u/<n>/app/<id>` 对话传 `newChat: true` 时正确继承 `/u/<n>/app` 不降级账号；
8. 若使用 `/gem/<id>` 入口，`startUrl` 校验与会话跳转正常；
9. 实测当前 Gemini Web 触发自动转 `pasted.txt` 附件的字符阈值，按实测校准 `maxPromptChars`。

## 不要做

- 不要用云浏览器、API、Playwright 顶替 Ego 操作 Gemini 网页版。
- 不要对 `.ql-editor` 用 `page.click()`、`page.fill()` 或对长文用 `execCommand("insertText")`。
- 不要新开第二个 `taskSpace`，也不要把两篇不同文章混进同一个 Gemini 对话。
- 不要在回复、日志或报错里输出账号邮箱、token、密码、密钥。
- 不要把 prompt、回答、稿子、图片写进 skill 目录或 `~/Downloads`，也不要把 `gemini-session.json` / `*.debug.txt` 提交进 Git。
- 不要替调用方挑标题、定稿子、点发布，也不要把 Gemini 拒审包装成已审过。
