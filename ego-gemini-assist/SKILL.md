---
name: ego-gemini-assist
description: 用本机 Ego 浏览器里已登录的 Gemini 做公众号审稿、改稿意见、爆款标题，或让 Gemini 起草一段中文。用户说「用 Gemini 审」「出几个爆款标题」「让 Gemini 看看这篇」「浏览器里问 Gemini」时用。先读 ego-browser skill 再操作。不用于微信后台发文（那是 wechat-mp-draft 的兜底）。
---

# Ego 里的 Gemini：审稿 / 标题 / 起草

账号已经登着（Pro）。地址 `https://gemini.google.com/app` 就是新对话。

## 先读

动手前跑 `ego-browser skill`，按它的 task space 规则。同一件事复用同一个 space。结果页用 `finish({ keep: ["p1"] })` 留着给用户看。

## 怎么填（这是坑，别换方法）

Gemini 输入框是 `.ql-editor`。下面这些会把整页和后续 task space 卡死：

- `page.click()` / `page.fill()`：页面永远不 idle，调用挂到超时。
- 一次 `execCommand("insertText")` 塞整篇长文：页面假死，之后连 `taskSpace()` 都进不去。`listTaskSpaces()` 还能用，但别连开新 space 去绕。

能用的顺序：

1. `page.evaluate` 聚焦 `.ql-editor`。有残留就 `selectAll` + `delete`（只清短内容，别拿它塞长文）。
2. `page.keyboard.paste(全文)` 一次贴完。贴完用 innerText 对一下首尾。
3. 发送按钮是 `aria-label="Send message"`。点完等 body 里不再出现 `Gemini is typing`。

`page.goto` 15 秒超时但地址已经是 gemini.google.com/app、readyState=interactive：停在这一页继续，不要新开 space。

## 问法

- 整篇丢进去说「审稿 / 别改事实 / 合规」时，Gemini 经常回「我只是一个文本 AI，在这方面没法帮到你」。这不是没发出去。
- 标题单独要，措辞用「只做文字编辑，给 N 个标题」，成功率高。
- 回复里的空格会变成 `&nbsp;`，用 innerText 核对，别用 HTML 原文做字面匹配。
- 它拒审就如实告诉用户「没审过」，别把标题列表说成审稿通过。

## 边界

- 不替用户登录、不猜验证码。要人工确认就 `handOff()`。
- 回复里不写账号邮箱。
- Gemini 的标题和事实以用户稿和插件 README 为准，它会把「免费」「所有 Agent」说满，写回稿子前删掉没实测的。
