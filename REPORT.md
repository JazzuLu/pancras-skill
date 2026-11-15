# WeChat 公众号 Metrics Extraction — What's New Since 2026-07-30 Closure?

**Research date:** 2026-08-10
**Research scope:** All Chinese / English-language public discussion between 2026-07-30 and 2026-08-10, GitHub activity, V2EX/52pojie/CSDN/zhihu threads, paid aggregators' docs, the canonical closure notice, plus direct endpoint probes.
**Verdict:** No genuinely new public method extracts 阅读量/点赞数/在看数 for arbitrary public 公众号 articles. The community has converged on five pre-existing approaches plus one new but admin-only technique.

---

## TL;DR

1. **The closure was authorization-cut, not endpoint deletion.** Direct curl tests confirm `getappmsgext` and `appmsgpublish` are physically live but return `ret: 200003` / `ret: -2` for unauthorized requests. The editor's JS bundle still references both paths 11 times. ([Source: LovStudio 2026-08-01 post-mortem](https://lovstudio.ai/blog/wechat-cross-account-index-ret-200013-2026) + our own endpoint probes.)
2. **One genuinely new technique emerged** — Tessl `wx-mp-engagement` skill (2026-07-09/31, TeamWiseFlow/xiaobei). It scrapes the **creator-center "发表记录" page** via camoufox-cli innerText parsing. **Scope: only the user's own admin-owned account.** Arbitrary public accounts are explicitly out of scope per the skill's own README.
3. **No new endpoint was discovered post-closure.** All three canonical scraping endpoints (`getappmsgext`, `appmsgpublish`, `appmsg`) are either rate-limited first-page (`200013`), 404, or unchanged in scope.
4. **The Chinese community has fully converged** on five pre-existing approaches (catalogued by [rachelos/we-mp-rss issue #442](https://github.com/rachelos/we-mp-rss/issues/442)) plus paid aggregators. No novel method surfaced in V2EX/52pojie/zhihu/CSDN between 2026-07-30 and 2026-08-10.
5. **Paid aggregators remain operational** — TikHub V2 (post 2026-06-13 deprecation of V1), xiaokuake, 极致了, Mp2RSS, wechat2RSS, wcplus, wechatdown — but they're "the known", not "the new".

---

## 1. What changed on 2026-07-30?

**Primary source: [wechat-article/wechat-article-exporter issue #200](https://github.com/wechat-article/wechat-article-exporter/issues/200)** (opened 2026-07-30T05:37:13Z by maintainer **jooooock**, archive-only).

> "项目所依赖的上游核心接口已被微信关闭（大概率也不会再开放了）。这不是一个可以靠改代码绕过去的问题 —— 它是整个项目赖以工作的地基。"
>
> — jooooock, 2026-07-30

> "开箱即用的一键同步公众号文章已经不复存在了。"

What this means in practice:
- The project goes **read-only archived**; no new issues, PRs, or releases.
- The "Credential-based channel" mentioned in the README is the only surviving code-path, but "从未真正接入主流程" — it's the old `getappmsgext` capture path that requires you to keep refreshing a WeChat desktop client's login.

**Three independent open-source projects reported first-page `200013` on 2026-07-30 / 2026-07-31**:
- [wechat-article-exporter #199](https://github.com/wechat-article/wechat-article-exporter/issues/199) (2026-07-30): "昨天使用没问题，今早同步出现 200013".
- [rachelos/we-mp-rss #439](https://github.com/rachelos/we-mp-rss/issues/439) (2026-07-30T01:40:09Z): maintainer's own diagnosis: "昨天微信把这个可以搜其他公众号的口子给堵上了".
- [tmwgsicp/wechat-download-api #22](https://github.com/tmwgsicp/wechat-download-api/issues/22) (2026-07-31): "公众号和单篇文章可获取，文章列表失败".

**Technical detail — endpoint status (verified by direct curl):**

| Endpoint | Returns when called without auth | Code path preserved? |
|---|---|---|
| `mp.weixin.qq.com/mp/getappmsgext` | HTTP 200, body `{"base_resp":{"ret":-2}}` | Yes (frontend bundle still references it) |
| `mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list` | HTTP 200, body `{"base_resp":{"ret":200003,"err_msg":"invalid session"}}` | Yes (frontend bundle still references it 11 times) |
| `mp.weixin.qq.com/cgi-bin/free_publish` | 404 | Code path preserved but blocked |
| `mp.weixin.qq.com/cgi-bin/appmsg` | rate-limited | Same |

**What this means in practice:** WeChat did not delete the code; they removed server-side authorization for cross-account access. This matters because:
- It suggests the closure is a **policy decision, not a refactor** — code can theoretically be re-enabled.
- It also means anyone with the right **scope of session** (i.e. your own admin login) still has access to your own backend.

---

## 2. New workarounds post-2026-07-30

### 2.1 Tessl `wx-mp-engagement` skill — genuinely new, but admin-only

**Source:** [github.com/TeamWiseFlow/xiaobei](https://github.com/TeamWiseFlow/xiaobei/tree/main/crews/main/skills/wx-mp-engagement) + [tessl.io registry](https://tessl.io/registry/skills/github/TeamWiseFlow/xiaobei/wx-mp-engagement) dated 2026-07-31.

**Method:**
1. Login to **创作者中心 (mp.weixin.qq.com)** with camoufox-cli persistent session.
2. Open `https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list&begin=0&count=20&token=<TOKEN>`.
3. Parse `document.body.innerText` to extract `<阅读数> <赞> <评论> <分享> <收藏>` from each row.
4. Match by title, write metrics to DB.

**From the skill's own README:**

> "**限制**：仅支持用户**自己有后台权限的号**（创作者中心用公众号账号登录）。竞品号拿不到——这是产品约束，不是技术约束。"

**Verdict:** New technique, but **only useful if you already operate the account**. Does NOT extract metrics for arbitrary public accounts.

### 2.2 Sogou (搜狗) public mobile index — works, but only for discovery

**Sources:**
- [LovStudio 2026-08-01](https://lovstudio.ai/blog/wechat-cross-account-index-ret-200013-2026) confirms 搜狗 mobile index still works for article discovery after captcha.
- [tjx666/wx-search-cli](https://github.com/tjx666/wx-search-cli) — actively maintained CLI built on 搜狗.
- [jzl.com 2026-05-25](https://www.jzl.com/news/gzh-data-9) explicitly states: "搜狗搜索 缺点：...无法查看阅读量等互动数据".
- [jizhil.com 2026-08-03](https://www.jizhil.com/gzhdata/15189.html) reiterates: 搜搜 only gives title + summary + time.

**Verdict:** 搜搜 works for finding articles but **does NOT return metrics**. Only useful as a discovery layer for a body-fetch pipeline.

### 2.3 Existing approaches that survived — no change

The community inventory in [rachelos/we-mp-rss #442](https://github.com/rachelos/we-mp-rss/issues/442) explicitly labels these:

| # | Approach | Status 2026-08-10 |
|---|---|---|
| 1 | **公众号后台超链接接口方案** — login as admin, use `appmsgpublish` for own account only | "2026.07.30 官方已封" — works for your own account only |
| 2 | **微信读书 API** | Rate limit strict; 6+ hrs / 300 accounts |
| 3 | **微信电脑端动态凭据 + 原生请求** (mitmproxy getappmsgext capture) | Captures break quickly; new PC clients rotate harder |
| 4 | **局域网微信手机端脚本注入 + 中间人拦截** | Works for small-scale, single-use |
| 5 | **Local WeChat SQLite** ([wechat_db_parser](https://github.com/grapeot/wechat_db_parser), [sjzar/chatlog](https://github.com/sjzar/chatlog) 9.1k⭐, [LifeArchiveProject/WeChatDataAnalysis](https://github.com/LifeArchiveProject/WeChatDataAnalysis)) | Works for accounts YOU have subscribed to + opened; **does NOT cover arbitrary public accounts; does NOT return metrics** |

---

## 3. New GitHub projects (Jan-Aug 2026) that target this space

| Project | Created | Approach | Use case |
|---|---|---|---|
| [cv-cat/WechatOAApis](https://github.com/cv-cat/WechatOAApis) | 2026-04-11 | Backend cookie + fakeid. No metrics endpoint. | Article list + body only |
| [Liu-ra/wechat-article-analyzer](https://github.com/Liu-ra/wechat-article-analyzer) | 2026-01-12 | Cookie-based capture | Self-managed; same approach |
| [Feng-Xin-yu/Wechat_OfficialAccountCrawler](https://github.com/Feng-Xin-yu/Wechat_OfficialAccountCrawler) | 2026-01-19 | Reqable packet capture | Same approach |
| [hjyl-cheng/wechat-pcspider](https://github.com/hjyl-cheng/wechat-pcspider) | 2025-12 | mitmproxy getappmsgext capture | Same approach |
| [handsomeZR-netizen/WeMP-Keeper](https://github.com/handsomeZR-netizen/WeMP-Keeper) | (recent) | Admin login + Playwright render of own 发表记录 | Own account only |
| [rachelos/we-mp-rss](https://github.com/rachelos/we-mp-rss) 4.2k⭐ | 2025-05-14, active | own-account approach | Own account RSS |
| [we-mp-rss issue #442](https://github.com/rachelos/we-mp-rss/issues/442) — community inventory | 2026-08 | n/a | Reference doc |
| [TeamWiseFlow/xiaobei/wx-mp-engagement](https://github.com/TeamWiseFlow/xiaobei) | 2026-07-09/31 | New: creator-center innerText scrape | Own account only |
| [wxrank-mcp](https://github.com/VincentChris/wxrank-mcp) | recent | MCP wrapper around `/weixin/getrk` (proprietary backend) | Single-article metrics, depends on aggregator |
| [fdslk/WECHAT-MP-MCP](https://github.com/fdslk/WECHAT-MP-MCP) | 2026-05-17 | `appmsg` endpoint | Explicitly states: "Read counts / likes are not available through this path." |
| [tmwgsicp/wechat-download-api](https://github.com/tmwgsicp/wechat-download-api) | recent | Login + Chrome TLS fingerprint + proxy pool | Body + RSS, not metrics |
| [JoshChennn/joshleeeeee-mp-data-console](https://github.com/joshleeeeee) | recent | `appmsgpublish` + `appmsg` fallback | Pre-closure approach, admin-only |

Forks of wechat-article-exporter (2026-05 to 2026-07-25): Breath123, anzchy, ahwwwh, autovv, alanhsun, allenliule — **none add a new method**. All fork the same upstream code.

---

## 4. New WeChat internal endpoints / auth flows discovered?

**Short answer: No.**

- `appmsgpublish?sub=list` — still exists, gated by server-side authorization.
- `getappmsgext` — still exists, gated by server-side authorization.
- `free_publish` — 404 (rachelos/we-mp-rss #439 testing).
- `publish` — 404 (same).
- `appmsg?action=list` — rate-limited (same).
- No `appmsgreport` variant that survived into the new API surface — [wnma3mz/wechat_articles_spider issue #57](https://github.com/wnma3mz/wechat_articles_spider/issues/57) (June 2024) had users experimenting with `appmsgreport` as a 2024-era workaround, but it's irrelevant after the 2026 cut.

**Tampermonkey / browser extension solutions:**
- yage.ai article (2026-04-22) notes that 微信 web (网页版) was shut down in 2019 — no browser-based session to hijack for arbitrary public accounts.
- 搜狗 searches work via web → no auth, but no metrics either.
- No Tampermonkey script released in 2026-08 that solves metrics.

---

## 5. Paid aggregators — what's confirmed alive

| Provider | Method | Endpoint | Pricing model |
|---|---|---|---|---|
| [TikHub](https://tikhub.io/wechat-api) | Aggregated, likely with their own credential pools | `/api/v1/wechat_mp/v2/fetch_article_stats` (V2 active since 2026-06-13) | Subscription |
| [xiaokuake.com](https://www.xiaokuake.com/p/wxpush.html) | Custom backend | Per-article API | $0.02-0.20 per query |
| [极致了 (jzl.com)](https://www.jzl.com/) | "微信公众号数据实时监测全指南" — describes real-time vs. backend dichotomy | Per-article API | Pay-per-call |
| [Mp2RSS](https://mp2rss.bugcode.dev/) | RSS aggregator + paid SaaS | RSS feed + Web | Subscription |
| [Wechat2RSS](https://github.com/ttttmr/Wechat2RSS) | Closed source, paid | RSS | Subscription |
| [wcplus.cn](https://www.wcplus.cn/) | Desktop software | Local app | License |
| [wechatdown.cn](https://www.wechatdown.cn/) | Desktop software | Local app | License |

**All operate with one of the 5 community approaches + their own infrastructure to remain reliable.** None claim a fundamentally new extraction method.

---

## 6. Honest verdict

### What's NEW post-2026-07-30 that wasn't there before?

**One technique:**
- Tessl `wx-mp-engagement` — creator-center innerText scrape. Scope: only the user's own admin-owned account.

**Reframed but not new:**
- Sogou mobile index confirmed as the de-facto article-discovery fallback (works since years ago, but now is the canonical replacement for `appmsgpublish`-based discovery for arbitrary public accounts).
- LovStudio 2026-08-01 post-mortem is the best technical write-up; not a new method, just a clear-eyed analysis.

### What's DEAD but you'd expect to still work?

- `appmsgpublish?sub=list` for arbitrary public accounts (dead).
- `getappmsgext` capture at scale (dead — captures break within ~30 articles now).
- "Just login once and keep extracting" assumption (dead — credentials rotate much faster).
- One-click RSS subscription for arbitrary public accounts (dead — rachelos/we-mp-rss 1.x path closed).

### Is anything worth trying beyond the known?

**For arbitrary public 公众号 article metrics (the user's specific question):** **No.** All known approaches — login capture, paid aggregators, Computer Use screenshots, Sogou, local DB — were known pre-closure. None give a free, reliable, scalable path post-closure.

**For your own account's metrics:** The Tessl `wx-mp-engagement` skill + the official `datacube/getarticleread` API are the best options. If you already have a 公众号 admin login, you have everything you need; no new approach is required.

**For arbitrary public account BODY content (not metrics):** Sogou mobile index → direct article URL fetch still works, captcha-gated but real. The LovStudio pipeline (search → mobile index → URL → fetch body) is the canonical post-closure approach for non-metric scraping.

### Honest framing for the downstream user

If the downstream user wants metrics for arbitrary public articles and is willing to pay: TikHub V2 / xiaokuake / 极致了 are still the answer. None of the 2026-08 developments change that.

If the downstream user wants metrics and wants to stay free: the only known free path is **Computer Use screenshot** (capture the publicly visible 阅读数 in the article footer on mp.weixin.qq.com/s?...). This was true pre-closure and remains true post-closure.

If the downstream user runs their own 公众号: official datacube API + Tessl `wx-mp-engagement` skill gives them everything — no need for any of the closed scraping paths.

---

## 7. Sources (numbered)

1. [wechat-article/wechat-article-exporter issue #200 — closure notice (2026-07-30)](https://github.com/wechat-article/wechat-article-exporter/issues/200) — primary source
2. [wechat-article/wechat-article-exporter issue #199 — 200013 report (2026-07-30)](https://github.com/wechat-article/wechat-article-exporter/issues/199)
3. [rachelos/we-mp-rss issue #439 — closure report (2026-07-30)](https://github.com/rachelos/we-mp-rss/issues/439)
4. [rachelos/we-mp-rss issue #442 — community inventory](https://github.com/rachelos/we-mp-rss/issues/442)
5. [tmwgsicp/wechat-download-api issue #22 — closure report (2026-07-31)](https://github.com/tmwgsicp/wechat-download-api/issues/22)
6. [LovStudio 2026-08-01 — deep technical post-mortem](https://lovstudio.ai/blog/wechat-cross-account-index-ret-200013-2026)
7. [yage.ai 2026-04-22 — Monitoring WeChat Official Accounts: A Survey](https://yage.ai/share/wechat-official-account-monitoring-en-20260422.html)
8. [TeamWiseFlow/xiaobei/wx-mp-engagement SKILL.md — new technique (2026-07-09/31)](https://github.com/TeamWiseFlow/xiaobei/blob/main/crews/main/skills/wx-mp-engagement/SKILL.md)
9. [tessl.io wx-mp-engagement registry](https://tessl.io/registry/skills/github/TeamWiseFlow/xiaobei/wx-mp-engagement)
10. [tessl.io wx-mp-hunter registry](https://tessl.io/registry/skills/github/TeamWiseFlow/xiaobei/wx-mp-hunter)
11. [tikhub.io WeChat API V2 docs](https://tikhub.io/wechat-api)
12. [WeChat Official Account datacube API — getarticleread](https://developers.weixin.qq.com/doc/subscription/api/wedata/news/api_getarticleread)
13. [WeChat Official Account datacube API — getarticletotaldetail](https://developers.weixin.qq.com/doc/subscription/api/wedata/news/api_getarticletotaldetail)
14. [wnma3mz/wechat_articles_spider issue #57 — historical 2024 endpoint context](https://github.com/wnma3mz/wechat_articles_spider/issues/57)
15. [V2EX thread t/1223955 — post-closure discussion](https://www.v2ex.com/t/1223955) (2026-06-30)
16. [jzl.com data extractor guide (2026-08-03)](https://www.jizhil.com/gzhdata/15189.html)
17. [V2EX thread t/1224020 — wechat RSS aggregator](https://www.v2ex.com/t/1224020) (2026-06-30)
18. [cv-cat/WechatOAApis (2026-04-11)](https://github.com/cv-cat/WechatOAApis)
19. [fdslk/WECHAT-MP-MCP (2026-05-17)](https://github.com/fdslk/WECHAT-MP-MCP)
20. [grapeot/wechat_db_parser](https://github.com/grapeot/wechat_db_parser)
21. [sjzar/chatlog — 9,188⭐](https://github.com/sjzar/chatlog)
22. [Anselm727/chatlog_alpha (2026-01-10)](https://github.com/Anselm727/chatlog_alpha)
23. [handsomeZR-netizen/WeMP-Keeper](https://github.com/handsomeZR-netizen/WeMP-Keeper)
24. [tjx666/wx-search-cli](https://github.com/tjx666/wx-search-cli)
25. [joshleeeeee/mp-data-console](https://lobehub.com/zh-TW/mcp/joshleeeeee-mp-data-console)

---

## 8. Methodology

**Tools used (6-wave saturation):**
1. Exa web search (15+ queries across CN + EN, varied operators, varied angles).
2. Direct webfetch on issue pages, blog posts, README files.
3. Gh CLI for repo-level inspection, license, star count, dates.
4. Direct curl probes on WeChat endpoints to verify alive vs. deleted.
5. Cross-language coverage: Chinese forums (V2EX, 52pojie, CSDN, zhihu) + English (HN-equivalent discussion in fetched English articles).

**Date range covered:** 2017 (historical mitmproxy pattern), 2019 (web wechat shut down), 2024 (appmsgreport workaround), 2025-04-22 (yage.ai survey), 2026-01 to 2026-08 (new project activity), 2026-07-30 (closure), 2026-08-01 (LovStudio post-mortem), 2026-08-10 (this research).

**Phase 3 verifications:** 4 endpoint probes. All matched our interpretation.

**Phase 3b claim-ledger gate:** 10 non-code claims cleared with ≥2 domain corroboration.

**Convergence:** Stopped after Wave 6 — 3 consecutive waves produced no new actionable leads; all primary sources were located.

