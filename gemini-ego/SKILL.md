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
  version: "0.2.1"
  date: "2026-11-22"
  status: "merged ego-gemini-assist live pitfalls; scripts/gemini-ask.mjs pending live smoke test"
---

# Gemini 网页操作（只走本机 Ego）

Gemini 网页版（`gemini.google.com`）只用本机已登录的 Ego 浏览器操作。不走云浏览器、不走 API、不走 Playwright。

先读 `ego-browser` skill（本机各 Agent 的 skills 目录下都有 `ego-browser`；不要写死某台机器的绝对路径）。按它的指引跑 `ego-browser skill`，浏览器 API 以当时输出的指南为准；本 skill 只规定 Gemini 网页版的流程、实测坑和调用约定。

固定文本提问流程在 `scripts/gemini-ask.mjs` 里（经 `ego-browser nodejs` 运行），调用方式见「怎么调脚本」。

## 总闸

- **只操作 Gemini 网页版**：不借这个 skill 登录其他站点、不发布任何内容。其他平台走各自 skill（公众号草稿走 `wechat-mp-draft`，X 发布走 `x-ego-send`，Magpie 服务端登录态排障走 `magpie-gemini-login`）。
- **单空间、复页面**：同一个目标始终复用同一个 `taskSpace` 和对话页（按运行期 `page.label` 保留）。**绝不**新开第二个 `taskSpace` 去绕开卡住的页面。
- **同一对话接着问，不擅自新开对话**：同一篇稿子、同一轮审稿、同一组标题、同主题配图都续在同一个 Gemini 对话里；调用方明确说「新开对话」或切换目标时才开新对话。
- **先核对登录态与账号**：
  - 本机 Ego 默认已登录 Pro 账号。注意多账号 URL 差异（默认 `/app` 为 `/u/0`，切账号为 `/u/1/app` 等），切错号会静默降级模型；续问时保留脚本返回的完整 `url`（含 `/u/<n>`）。
  - 若调用方指定了目标账号，动手前核对页面上的登录账号；未登录、错号、登录墙、密码、扫码、2FA、验证码一律停手，不输密码、不清 cookie，用 `task.handOff()` 交给用户。
  - **回复、日志和报错里不要输出账号邮箱。**
- **不污染仓库、不放密钥**：skill 目录只放代码和说明；prompt、回答、草稿、生成图片一律存到调用方任务目录的绝对路径。脚本和 prompt 中绝不放 token、密码、密钥。

## Gemini 网页实测坑（别换方法）

以下规则来自 live Gemini 实测，违反会直接把页面和后续 `taskSpace` 卡死：

1. **输入框 `.ql-editor` 的禁区**：
   - **禁止**对 `.ql-editor` 调用 `page.click()` 或 `page.fill()`：页面永远不 idle，调用会挂到超时并波及后续 space。
   - **禁止**一次 `document.execCommand("insertText", ...)` 塞整篇长文：页面会假死，之后连 `taskSpace()` 都进不去（若误触发，不要连开新 space 去绕）。
2. **已验证可用的输入与发送顺序**：
   1. 用 `page.evaluate()` 聚焦 `.ql-editor`；若有短残留文本，先用 `Range` 把选区限定在 `.ql-editor` 内再删除（超过 2000 字长残留直接 `handOff()` 给用户清理）。
   2. 用 `page.keyboard.paste(全文)` 一次贴完；贴完后读取 `.ql-editor` 的 `innerText`（规整 `&nbsp;` 后）核对首尾一致再发。
   3. 在输入区容器内精确查找发送按钮 `aria-label="Send message"`（中文兼容 `发送消息` / `傳送訊息`，避免误点「发送反馈」）；点击后确认输入区清空或生成启动，再等待状态指示与停止按钮消失且最新回复节点稳定。
3. **`page.goto` 假超时**：`page.goto` 15 秒超时但当前 URL 已经到达目标 `/app`（含 `/u/<n>/app`）且 `document.readyState` 为 `interactive` 或 `complete` 时，停在这一页继续操作，不要重试新开 space；若仍停留在旧会话未跳转，按超时报错处理，绝不把问题发进旧对话。
4. **`&nbsp;` 空白差异**：Gemini 回复中的空格常为 `&nbsp;`（`\u00a0`），核对和提取一律使用 `innerText` 并将 `\u00a0` 归一化为普通空格，不要用 HTML 原文做字面匹配。

## 怎么调脚本

脚本路径：`scripts/gemini-ask.mjs`，通过 `ego-browser nodejs` 运行。脚本不读 shell 环境变量、不认相对路径，所有文件路径必须是**绝对路径**。

### 输入字段

调用方需提供齐以下信息（缺少必选项就先问，不要猜）：

| 字段 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `prompt` / `promptFile` | 二选一（都空=只取回答） | `""` | 不能同时非空。短提问可直接填 `prompt`；**含引号/换行或长文本（稿件、corpus、审稿清单）一律写文件后传 `promptFile` 绝对路径** |
| `convUrl` | 否 | `""` | 要续的 `https://gemini.google.com/app...` URL；留空时若新建 space 或不在 `/app` 会打开 `/app`，已在对话页则留在当前对话；要强制新开对话请显式传 `"https://gemini.google.com/app"` |
| `spaceId` | 否 | `null` | 上一轮返回的整数 `spaceId`；`null` 表示新建 space |
| `spaceName` | 否 | `"gemini-web"` | 新建 space 时的名称（撞名时脚本自动加后缀） |
| `expectedAccount` | 否 | `""` | 可选；若调用方点名账号，传入用于页面核对（脚本不会将其打印到输出或报错中） |
| `outFile` | **是** | `""` | 回答写入的绝对路径（父目录不存在会自动创建；同时输出脱敏后的 `outFile.debug.txt` 备用） |
| `finish` | 否 | `true` | `true` = 成功后自动 `task.finish({ keep: [pageLabel] })`（单步结束回复用）；同一轮回复内后面还有浏览器步骤（如接着下载生图或立刻追问）时设为 `false`，待本轮所有步骤完成后再单独调 `task.finish({ keep: [pageLabel] })` |

### 推荐跑法（无需手抄整份脚本）

用 `node` 生成安全的 JSON 输入头部，拼接 `scripts/gemini-ask.mjs` 管道给 `ego-browser nodejs`（把 `<SKILL_DIR>` 换成本 skill 的绝对路径；若短 `prompt` 含英文单引号，请改用 `promptFile` 避免破坏 bash 单引号边界）：

```bash
{
  node -e 'console.log("globalThis.__GEMINI_INPUT__ = " + JSON.stringify({
    prompt: "",
    promptFile: "/abs/path/to/prompt.txt",
    convUrl: "",
    spaceId: null,
    expectedAccount: "",
    outFile: "/abs/path/to/response.txt",
    finish: true
  }) + ";");'
  cat "<SKILL_DIR>/scripts/gemini-ask.mjs"
} | ego-browser nodejs
```

若沙箱限制管道，也可将 `scripts/gemini-ask.mjs` 填入 `DEFAULT_INPUT` 后通过 `ego-browser nodejs <<'EOF' ... EOF` 运行。

### 输出与续轮

脚本 stdout 只输出**单段 JSON**：

```json
{
  "ok": true,
  "spaceId": 7,
  "page": null,
  "finished": true,
  "url": "https://gemini.google.com/app/xxxxxxxx",
  "responseFile": "/abs/path/to/response.txt",
  "extractionMode": "model_response"
}
```

- **关于 `page` 与 `finished`**：按 `ego-browser` 规范，`finish()` 会作废所有 Page label（含保留页）。因此 `finished: true` 时脚本返回 `page: null`（下一轮需先 `claimTaskSpace(spaceId)` 再 `adopt`）；只有 `finish: false` 时 `page` 才返回本轮仍有效的 label（如 `"p1"`）。
- **同时保存 `spaceId` 和 `url`**（建议写入调用方任务目录的 `gemini-session.json`）。首轮新对话发完后 URL 会从 `/app` 变成 `/app/<id>`，下一轮续问要同时带上这两个值。
- **只取回答模式**：`prompt` 和 `promptFile` 都留空时，脚本不会刷新当前 Gemini 对话页、也不会重发问题；若页面仍在生成会等到完成，再提取最后一条模型回复。超时或 `handOff` 回来取答案务必用此模式，避免重复发问。
- **异常与 `handOff`**：任何一步失败都会停止，输出统一结构 `{ ok: false, error, handOff, spaceId, page, url, ... }`（不含原始 snapshot 与账号邮箱；脱敏诊断写入 `outFile.debug.txt`），且**不调用 `task.finish()`**（保住现场页面便于排查或人工接管）。
- **`extractionMode` 检查**：正常应为 `"model_response"`；若降级为 `"fallback_body"`，说明 Gemini 改版导致回答容器选择器未命中，需结合 `outFile.debug.txt` 核对并更新脚本选择器。

## 常见任务与问法经验

- **起草 / 改稿**：草稿与回答一律写入调用方任务目录的绝对路径。**仅当**调用方显式提供了写作规范/corpus（如 style guide、production spec、voice lexicon）时，先读 corpus 并在回报前按 corpus 逐项自查；未提供 corpus 时不私自套用特定项目的格式限制。
- **审稿**：把稿件 + 审查清单发给 Gemini 拿编号意见。**实测坑**：整篇丢进去要求「审稿 / 别改事实 / 合规」时，Gemini 经常拒答（「我只是一个文本 AI，在这方面没法帮到你」），这不是没发出去。若被拒审，必须如实回报「没审过」，**绝不把标题列表或泛泛回复当成审稿通过**。
- **爆款标题**：在同一对话里单独要，措辞用「只做文字编辑，给 N 个标题」成功率更高。标题由调用方挑，agent 不代挑。
- **事实把关**：Gemini 容易把「免费」「所有 Agent」等表述说满；回写稿件前删掉未经实测的夸大内容，事实以用户原稿、代码和官方文档为准。
- **生成图片**：
  - 在同一对话里让 Gemini 生图（若同轮还要继续下载图片，提问脚本可传 `finish: false`，下载完成后再统一 `task.finish({ keep: [pageLabel] })`）。
  - **下载方式**：Gemini 图片 CDN 通常跨域，`page.fetch()` 受浏览器 CORS 限制容易失败；按 `ego-browser` 规范，**先挂 `const downloadPromise = page.waitForEvent("download", { timeout: 30_000 })`，再点击图片上的下载按钮**，最后 `await (await downloadPromise).saveAs("/abs/path/image.png")` 直接存到调用方任务目录。
  - 不要存进 `~/Downloads`，也不要存进 skill 目录。

## 首次 live 脚本烟测清单

`scripts/gemini-ask.mjs` 首次在 live Gemini 上跑通时，顺手核对这 6 项，通过后把 `metadata.status` 改为已验证并更新日期：

1. 账号按钮选择器是否能正确识别当前已登录状态（不误触发 `handOff`）；
2. `.ql-editor` 聚焦 + `keyboard.paste` 首尾核对是否通过；
3. `aria-label="Send message"`（或中文按钮）触发发送后，输入区清空且生成开始；
4. 状态指示 / 停止按钮判定能扛住 Thinking 阶段不早退，且回复正文未混入 `model-thoughts`；
5. 返回的 `extractionMode` 为 `"model_response"` 且 `url` 已更新为 `/app/<id>`；
6. 带 `spaceId + url` 续轮提问，以及 `prompt=""` extract-only 不重载取回答均正常通过。

## 不要做

- 不要用云浏览器、API、Playwright 顶替 Ego 操作 Gemini 网页版。
- 不要对 `.ql-editor` 用 `page.click()`、`page.fill()` 或对长文用 `execCommand("insertText")`。
- 不要新开第二个 `taskSpace` 或新对话来绕开卡住的页面。
- 不要在回复、日志或报错里输出账号邮箱、token、密码、密钥。
- 不要把 prompt、回答、稿子、图片写进 skill 目录或 `~/Downloads`。
- 不要替调用方挑标题、定稿子、点发布，也不要把 Gemini 拒审包装成已审过。
