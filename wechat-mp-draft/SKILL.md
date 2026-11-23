---
name: wechat-mp-draft
description: 把硅基茶馆2077的公众号稿存进微信草稿箱。用户说「发草稿」「存草稿箱」「更新公众号草稿」时用。第一选择永远是本机 AppID/AppSecret 调草稿 API；只有 API 明确失败（白名单、凭证失效、接口连续 501）才用 Ego 打开 mp.weixin.qq.com 手工改，而且先告诉用户。只存草稿，不群发、不发布。
---

# 公众号草稿

脚本在 grok-bot-workspace：`skills/wechat-publish/scripts/wx_draft.py`。稿件目录 `content/03-drafts/<slug>/`，HTML 用 baoyu-markdown-to-html 的 grace 主题、主色 `#0F766E`（墨绿，2026-11-16 已定）。

## 凭据

- 文件：`~/.secrets/wechat.env`（600，仓库外）。两行 `export WECHAT_APP_ID` / `export WECHAT_APP_SECRET`。
- 调用：`DSH_TOOLS_MD=$HOME/.secrets/wechat.env python3 .../wx_draft.py ...`
- 不把 Secret 写进 MEMORY、日报、仓库、聊天回复。不 cat 这个文件。用户说重置了再改文件。
- 脚本不读 grok-bot-workspace 里的文件。那个目录是 git 仓库（github.com/JazzuLu/grok-bot-workspace），密钥放进去会跟着提交走。

## 发之前

1. 摘要以 `summary.txt` 为准，先改对再发。脚本不会用正文第一段覆盖旧摘要。
2. `--dry-run`：create/update、封面在不在、摘要 ≤120、没有「截图」占位和 `<h1>`。
3. 正文图还没截就不要留 `<!-- 图N -->`，排版前删掉。

## 发布

- 这篇还没有 `layout/draft.json`：用户同意后加 `--allow-create`。
- 已有 media_id：先不加 `--allow-create`，走原地更新。

## draft/update 返回 501

响应是腾讯 WAF 的 HTML（`waf.tencent.com/501page.html`），不是微信 errcode。add 能过、update 被拦。精简字段也一样。

处理：`draft/delete` 删掉这篇自己的 media_id（先 batchget 对标题，别删别人的草稿）→ 删 `layout/draft.json` → `--allow-create` 重建。重建前确认 summary.txt 已是新的。

## 兜底：Ego 进后台

只在 API 走不通时用。先说一声再开 `https://mp.weixin.qq.com`。登录、扫码、验证码交给用户。后台只改草稿，不点群发、不点发表。

## 做完

读回 draft/get：标题、摘要、封面、正文长度、有没有残留占位。告诉用户去草稿箱预览，发布他自己点。
