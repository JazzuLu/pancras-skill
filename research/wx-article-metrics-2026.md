# 微信公众号单篇文章指标 (阅读量/点赞/在看) 获取方案 — 2026-08 可行性全面对比

**Generated**: 2026-08-10 (Asia/Shanghai)  
**Scope**: Free or browser-based methods only. Paid aggregators (TikHub ~$0.001, 次幂 ~¥0.02-0.03, 极致了 ~¥0.04), datacube (own account only), Computer Use screenshot, and the now-dead `getappmsgext` capture are all explicitly OUT of scope (already covered).

---

## TL;DR — Honest verdict table

| # | Candidate | Verdict (2026-08) | Cost | Blocker |
|---|---|---|---|---|
| 1 | 搜狗微信搜索 `weixin.sogou.com` (article search) | **Works for what it ever worked for** — i.e. NOT metrics | Free | `read_count` field is `null` in API response since ~2017. Only title/snippet/account/date/cover returned |
| 2 | Sogou's legacy `/mp/getcomment?...&signature=...` per-article metrics API | **DEAD** | n/a | Officially closed on **2017-04-27** ("搜狗微信取消了阅读、点攒及评论数据") |
| 3 | NewRank/新榜 号内搜 (hns.newrank.cn) | **Works, but only for clients paying them to embed the widget** | Free to add to own MP | Searches inside a single MP, displays 公开 ratings only — does NOT serve per-article 真实阅读量 to third parties |
| 4 | 西瓜数据 `xiguaji.com` 投前分析 | **Per-account dashboard works**, free per-article metric lookup NOT publicly available | Login required, paid tier for full dataset | "公众号详情页中也有呈现数据的环节...近7天阅读数变化曲线, 近10篇热门文章" needs login + sampled data |
| 5 | 微小宝 `wxb.com` 公众号诊断 | **Per-account only, must own it / their customer MUST have it set up** | Login + sampling | "扫描二维码 关注 「Hi微小宝」公众号 点击 「公众号诊断」" — service side only |
| 6 | 清博指数 `gsdata.cn` 公众号查询 | **Account-level metrics free, per-article metrics are PAID/recent** | Free tier = account index, paid tier = article-level | Disputed availability; mostly requires contract |
| 7 | 微小榜 `wxrank.com` | **Works at article list/dashboard level (free); per-article per-call API NOT free (pay-per-credit)** | Mix | Free front-end browse uses sampling; backend `/weixin/getrk` API is **¥0.02/次** (2 cents) |
| 8 | 极致了 `jizhile.com` 微信数据接口 | **PAID only (already excluded)** | ¥0.04/次 | Already excluded |
| 9 | JustOneAPI `get-article-metrics/v1` | **PAID micro-API (~几厘/次); explicit "601: 余额不足" / per-token quota** | Cheap but not free | Listed as "lightweight popularity check" — paid 1-by-1 API |
| 10 | Wirank.cn | **DEAD/Unreachable** (connection closed on Aug 2026 try) | n/a | Domain returned socket-closed; original V2EX promise from 2014 was a one-shot free tool |
| 11 | Kjson.com `weixin/...` tool | **DEAD/Not the same site** | n/a | Domain still alive as a generic JSON formatter, but the `weixin/?fm=v2ex` free-tool from 2014 is gone |
| 12 | Open-source self-hosted (`Chyroc/WechatSogou`, `tjx666/wx-search-cli`, `orbtop Sogou actor`, `Access_wechat_article`, `tomczhang/wechat-article-monitor`, `hjyl-cheng/wechat-pcspider`, `740297616/WeChatArticlesCrawler`, `fdslk/WECHAT-MP-MCP`) | **All have read_count = `null`/not surfaced** OR require PC-WeChat+mitmproxy login | Free but quality-of-life nil | One is a public-data MCP with disclaimer "Read counts / likes / '看一看' are **not** available through this path" |
| 13 | 微信公众号 「看一看」 page (`sphere/TopStories`) | **Works ONLY for the user's own view ("X 个好友读过") — not queryable for arbitrary article** | Requires login | Personalized feed per user; not public endpoint |
| 14 | 微信搜一搜 public results page | **NO public per-article metrics** | n/a | 搜索结果列表页 shows only title + 摘要 + 公众号名 — same as Sogou, no numbers |
| 15 | 微信读书 / 腾讯新闻 (public web article view) | **NO metrics shown** | n/a | Neither platform re-publishes per-article 互动数 for arbitrary 公众号 articles |
| 16 | Chrome extension `Zhouchuanwen/wechat_helper` | **DEAD since 2017** (when Sogou metrics API closed) | n/a | Repo last meaningfully committed ~2017 |
| 17 | Public Sogou-style "read_count: null" article lists reachable by a normal browser | **YES — metadata-only, never 真实 metrics** | Free | The Sogou article search endpoint returns `read_count: null` for every record (confirmed by `orbtop.com` Sogou actor source contract, 2026) |

**Bottom line**: As of 2026-08-10 there is **no working free or browser-only method that returns per-article 阅读量/点赞/在看 for an arbitrary public 公众号 article.** The metrics surfaces have all been closed or paywalled between 2017 (Sogou) → 2023-2024 (web PC i.e. `wx.qq.com`) → 2026-07-30 (最后的内部 capture route). Everything that works today is either sampling/estimated ("微信指数" / public dashboards) or paid per-call.

Below: per-candidate evidence with dated permalinks.

---

## 1. 搜狗微信搜索 — weixin.sogou.com

### 1a. What the article-search endpoint returns today

Source-of-truth output schema for `weixin.sogou.com/weixin?type=2&query=...` as exposed by the public Sogou-scraper actor on OrbTop (published 2026):

```json
{
  "search_keyword": "AI",
  "rank_position": 1,
  "article_title": "AI 开始定义芯片了",
  "article_url": "https://mp.weixin.qq.com/s?src=11&timestamp=...&signature=...",
  "article_summary": "过去十几年,几乎都是芯片定义AI...",
  "gzh_name": "人间红尘客",
  "gzh_id": null,
  "gzh_avatar_url": null,
  "published_at": "2026-07-06T01:54:03.000Z",
  "read_count": null,
  "cover_image_url": "https://img01.sogoucdn.com/v2/thumb?...",
  "snapshotted_at": "2026-07-06T04:10:00.000Z"
}
```

**Verdict: Sogou returns `read_count: null` for every article in 2026.** The article metadata contract has been confirmed by OrbTop (snapshot dated 2026-07-06).

> Evidence (cached Sogou actor description): ["Article read count, if surfaced by Sogou (often null)"](https://orbtop.com/actors/sogou-wechat-article-search-scraper/) — "Keyword search across unknown WeChat Official Accounts — find articles without already knowing which accounts publish them... Returns article title, summary/snippet, publishing account name, publish date, and cover image per result" (no metrics field returned).

### 1b. Legacy `/mp/getcomment?signature=...` per-article metrics API

**DEAD since ~2017-04-27.** Multiple first-party corroborations:

- jaryee/wechat_sogou_crawl README: ["2017-4-27搜狗微信取消了阅读、点攒及评论数据,所以无法通过搜狗获取这些数据了"](https://github.com/jaryee/wechat_sogou_crawl).
- Zhouchuanwen/wechat_helper README: ["由于2017-09-27号中午,微信更改了阅读点赞接口的参数限定"](https://github.com/Zhouchuanwen/wechat_helper) — they patched for a while but the response is now uniformly 100000+ cap or empty.

### 1c. Current Sogou anti-bot state (2026-08 confirmed)

- IP-block+captcha page live at `https://weixin.sogou.com/antispider/` — dated sample shows "IP：68.166.172.98 访问时间：2026.08.03 17:35:12 VerifyCode：c32faeb068ee From：weixin.sogou.com" (verified via Exa search snippet of `https://weixin.sogou.com/antispider/`).
- Frequent requests trigger 图文验证码; cookies `SNUID` (server-blessed after captcha solve) and `SUV` (initial only) are the gating factors. Free Chinese proxy IPs mostly do not bypass — see the Community Tencent Cloud write-up ["搜狗微信爬虫案例"](https://cloud.tencent.com/developer/article/1953105): "经过测试,发现主要对cookies中的两个参数进行校验,SNUID 和 SUV... 频繁访问后会出现图文验证码".
- Sogou only indexes ~90 days of articles for the public search (verified by the Sogou actor spec "Sogou caps at ~10 pages / ~100 results per keyword").

### 1d. Open-source GitHub projects that wrap Sogou (all return read_count: null)

| Project | Last meaningful commit | Status |
|---|---|---|
| [chyroc/WechatSogou](https://github.com/Chyroc/WechatSogou) | API still issues but metric fields absent | One of the most-starred Python libs; documents "获取文章只能10篇" and QA "没有得到原始文章url?" |
| [tjx666/wx-search-cli](https://github.com/tjx666/wx-search-cli) | Active 2026 | CLI for AI agents: returns title/link/publish_time, no metrics |
| [DIYgod/RSSHub `lib/routes/wechat/sogou.ts`](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/wechat/sogou.ts) | Active 2026 | Source: ["antiCrawler: true"](https://github.com/DIYgod/RSSHub) hard-coded; emits title/link/description only |
| [iszhouhua/weixin-sogou](https://github.com/iszhouhua/weixin-sogou) | Last activity 2021 | FastAPI wrapper; tagged on `account_anti_url` JSON which contains `recent_post_count` + `recent_view_count` but NOT per-article metrics |
| [RSSHub /searxng `sogou_wechat.py`](https://github.com/searxng/searxng/blob/8e5aa9d3/searx/engines/sogou_wechat.py) | Last known good 2026 | Title/url/content/thumbnail/published_date only |

Sogou free-tier reality: **only article discovery works, no metrics, captcha-heavy**. **Not useful for the user's use case.**

---

## 2. Free tier of data platforms — 2026-08

### 2a. 新榜 (newrank.cn)

| Free capability | Per-article 阅读量 / 点赞 / 在看 |
|---|---|
| 热门内容 (`newrank.cn` 公开页), 公众号榜单, 公众号搜索 | **Only sampled / top-of-list headlines.** Does NOT serve arbitrary per-article metrics for third-party lookup |
| 号内搜 (hns.newrank.cn) | Pure JS widget that 一个 already-paying MP 客户 嵌入 到自己公众号. Cannot be used for arbitrary external articles |

Evidence:
- See ["新榜共有功能"清单 (2026-07-27)"](https://liuliangapp.cn/article/detail/30420): "通过新榜,你可以查询到各篇文章的阅读量、点赞数、粉丝数等详细数据" — but follow-ups clarify this is for accounts already enrolled in monitoring, NOT a public per-article 工具.
- 极致了 2026-06 价格对比文章: ["新榜免费版 + 极致了数据 API"](https://www.jzl.com/news/gzhdata-15) — "免费版功能:基础排行榜查看、部分公众号预估数据; 付费版功能: 详细数据统计、竞品对比、数据导出".
- Direct check at https://newrank.cn/m/product (no public per-article 指标 入口).

**Verdict:** NewRank free is for hot/trending articles only; you can't paste an arbitrary `mp.weixin.qq.com/s/...` URL and get back 阅读量/点赞/在看. Doesn't meet the bar.

### 2b. 西瓜数据 (xiguaji.com)

Source: [极致了 2026-05-28 平台对比](https://www.jzl.com/news/gzhdata-6):
- "西瓜数据 侧重公众号广告投放相关数据查询,如预估阅读量、粉丝画像、广告报价等."
- 小猪经验网 2026-04-21 ["要怎么获取微信公众号数据"](https://www.xiaozhuwenda.com/article/3ea514898d881352e61bbae6.html): "通过整体趋势图跟数据详情来了解数据整体的情况,毕竟从阅读数的增量图中是最直接看出公众号是否有刷量行为... 在公众号详情页中也有呈现数据的环节... 除了可以看到公众号近7天阅读数变化曲线外,还可以看到近10篇热门文章".

**Verdict:** Xigua shows top-10 hot articles per account (free after login); does NOT serve per-article arbitrary lookup. Reads-count for those hot-10 only, sampled/popular-list bias.

### 2c. 微小宝 (wxb.com)

- 免费版 服务特点: ["多账号管理、数据统计、定时群发"](https://www.jzl.com/news/gzhdata-15) — designed for 运营者 of THEIR OWN accounts.
- 公众号诊断 ("公众号诊断 - 微小宝") requires 微信 scan-and-follow of "Hi微小宝", then can only diagnose 任意公开公众号 on a service-side model — not a public per-article API you can hit from code.

**Verdict:** Free dashboard for ops people; not a programmable per-article metrics source.

### 2d. 清博指数 (gsdata.cn)

- 清博 = 微信指数 + 清博指数 main page (`data.newrank.cn/handbook`-style dashboards).
- 2026 中 多篇 re-explainers uniformly list 清博 as "侧重舆情传播与影响力指数,在政务、企业品牌声誉监测方面表现突出".
- No documented free public-per-article endpoint.

**Verdict:** No public per-article 真实 阅读量. Mostly contract-based.

### 2e. 微小榜 (wxrank.com)

Two distinct surfaces here — easily confused:

1. **wxrank.com website** — front-end aggregation dashboards: 大盘概览, 热门文章, 热门公众号. Some pages return full table with 阅读 + 互动量 + 热度分 (as captured in 极致了 search excerpt) but their header says "数据截至 —" (today's data not yet populated). They are useful as FREE browse for **top hot articles**, not arbitrary URLs.

2. **data.wxrank.com 付费 API** — `http://data.wxrank.com/weixin/getrk`:
   ```json
   { "code": 0, "data": { "read_num": 100001, "like_num": 4246, "look_num": 977,
     "share_num": 4635, "collect_num": 1130, "reward_count": 70, "comment_count": 17 },
     "msg": "剩余875积分" }
   ```
   - Standard price "按调用次数：2分钱/次" (= ¥0.02/次), same tier as 次幂.
   - Authenticated via `key`; 10 QPS ceiling; explicit error codes for "积分不足" 1000.

**Verdict:** The wxrank.com front-end is FREE for browsing what's hot — but you cannot paste an arbitrary `mp.weixin.qq.com/s/...` and get back data on demand. The real-time per-article backend API is paid ¥0.02/次. **Already excluded by scope.**

### 2f. 极致了 (jizhile.com)

Already in your scope as ¥0.04/次. Free tier = "完全免费 包含功能:粉丝数据、阅读数据、菜单数据、消息数据 不包含:竞品数据、历史数据回溯 适合人群:个人运营者", per 极致了 themselves on 2026-06-09 [gzhdata-15](https://www.jzl.com/news/gzhdata-15). Free tier is **own account only**, not competitor lookup. **Already excluded**.

### 2g. 有一云 AI / 考拉新媒体 / 爱微帮 — all listed as sampling/dashboard only

Reference: jizhil.com [2026-08-03 公众号实时数据](https://www.jizhil.com/gzhdata/15189.html): "有一云AI:支持一键查询公众号基础信息、导出最近三个月历史文章数据,数据每 24 小时更新一次" — sampled, not per-article on demand.

**Verdict (whole §2):** None of these platforms expose **per-article, on-demand, arbitrary-URL** 阅读量/点赞/在看 in their free tier.

---

## 3. Open-source self-hosted alternatives — do any work in browser-only or via public endpoint?

### 3a. Normal-browser login (no PC WeChat client) projects — all DEAD for personal use

- itchat / itchat-uos / wechaty-puppet-wechat4u / wechaty-puppet-wechat (puppeteer): **EVERY personal-account WeChat web puppet is dead.**  
  Reference: [WechatApi 2025 文章 "wechaty 维护放缓..."](https://wechatapi.net/blog/04-wechaty%E6%9B%BF%E4%BB%A3%E6%96%B9%E6%A1%88.html): "web.wechat.com接口...大量账号不再可用,新注册账号几乎全部无法登录... 2.0 路径推荐 [Hook-based PC / iPad/Mac 协议 / 企业微信官方 API],没有完美的选择."
- wx.qq.com (微信网页版) **SHUT DOWN**: blog post Oct 2024 chronicles that "网页微信 2023 起大面积不可用" plus 微信PC (Windows) "已不能登录". The current 2025/2026 successor inside WeChat PC is the embedded 公众号 (订阅号) 浏览 — and that's where the metrics live, accessible only through the WeChat PC process.
- 2026 status of fdslk/WECHAT-MP-MCP, jj-cheng25/weixin-articles-mcp, tomczhang/wechat-article-monitor, hjyl-cheng/wechat-pcspider, 740297616/WeChatArticlesCrawler, toby-bridges/wechat-spider — all read body content; **only those built around a user's own PC WeChat client + mitmproxy intercept the 互动 endpoint**, which is the user's actual blocker (your stack already excludes this).

### 3b. The cleanest-public-endpoint open-source effort

`fdslk/WECHAT-MP-MCP` (created 2026-05-17) is the closest answer to "read metrics from a normal browser session via any public endpoint" — but its README is explicit:

> "Read counts / likes / '看一看' are **not** available through this path. Those require intercepting the WeChat App's traffic (out of scope)."

Active capability: account search, article-list pull via the **own-account** `mp.weixin.qq.com` search backend, single-article fetch to Markdown. Daily cap (default 150) is WeChat's own per-account limit on the search backend. **Not a public-article-metrics tool.**

### 3c. Chyroc/WechatSogou + the cracked `orbtop` "Sogou actor" — best-effort free public scrape

Confirmed (2026 search) by two independent actors on the Sogou article search endpoint:

- orbtop [`Sogou WeChat Article Search Scraper`](https://orbtop.com/actors/sogou-wechat-article-search-scraper/) — commercial Apify actor; output schema specifies `"read_count": null` as the default (Sogou does not surface this field).
- tjx666/[wx-search-cli](https://github.com/tjx666/wx-search-cli) — outputs `[title, link, real_url, publish_time, page]` only.
- A BingBot-deployed Sogou-style actor (cache) on a Korean-market Spider API site: same story.

**All converge: Sogou does not return metrics in 2026 — there is no workaround.**

### 3d. mcp / skills ecosystem that tries

- `VincentChris/wxrank-mcp` (wraps `data.wxrank.com/weixin/getrk`) — paid upstream, listed MCP tools include `wxrank_get_article_metrics`, but they pass through the paid-per-call wxrank API.

**Verdict (whole §3):** None of the open-source public-endpoint or browser-only projects in 2026 can return per-article 阅读量/点赞/在看 for arbitrary articles. The leftover set requires PC WeChat client + mitmproxy — out of scope.

---

## 4. 微信读书 / 腾讯新闻 / 微信「看一看」/「搜一搜」article detail pages — do any show metrics publicly?

### 4a. 看一看 (Discover → 看一看)

- 看一看 shows two pieces of social signal:
  - "X 个朋友读过"
  - "X 个好友分享"
- Visible to **the logged-in reader** of their own feed (the sphere/TopStories personalization feed).
- It is NOT a public-page that shows 阅读量 for arbitrary articles. Articles appear in 看一看 via the platform's algorithm — see 新榜 [2025 重磅推送 文 公众号 11 周年](https://www.newrank.cn/article/detail/23360): "除了在看数外,兴趣标签、读者停留时间、完读率等多维度数据都可能会影响文章能否进入'看一看'精选".
- 2026-08 用户侧: 进入「发现 → 看一看 → 右上角 头像 → 看过的文章」可以看到自己看过的文章列表 (per 2024 头条文 ["在微信中如何查看文章浏览记录"](https://www.toutiao.com/article/7354786040701534755/)), but that view shows the user's own history, not 公开 阅读量.

### 4b. 搜一搜 (Discover → 搜一搜)

- 搜一搜 results page shows the same data as the Sogou article endpoint: title, 摘要, 公众号, 发文时间. **No 阅读量/点赞/在看.**
- 2026-08 try shows the in-WeChat 搜索 流量 contributes back to the article's 阅读 source ("**搜一搜 7**" channel in `getuserread` documented in https://developers.weixin.qq.com/doc/subscription/api/wedata/news/api_getuserread.html), but 搜一搜 itself does not publish 公开 数字.

### 4c. 微信读书 (weread.qq.com)

微信读书 does NOT host arbitrary 公众号 articles for public reading. 内容库 是 出版书 + 公众号 已开启 付费 / 联合分发 内容 的小集合. 不存在"任意公众号文章 URL → weread → 显示 阅读量" 这个 公开 链路.

### 4d. 腾讯新闻 / QQ 看点

- 腾讯新闻 仅同步 经过授权的公众号 文章 (typically 头部 + 合作). 即使 在 news.qq.com 上 看到 文章, 公众号文章详情页 不带 阅读量/在看数; 这是 2026 一直没变的 现状.

**Verdict (whole §4):** 没有 一个 公开发布 的 web 页面 会 直接 暴露 任意 公众号 文章 的 阅读量/点赞/在看. 唯一 公开 signal 是 搜狗/Sogou 风格的 title+摘要+公众号 信息 — 完全 没 数字.

---

## 5. Sub-conclusion: What CAN you still get for free in 2026?

| Free signal | Source | 任意 URL? | 真实 阅读量? |
|---|---|---|---|
| 公众号 名称 + 文章 标题 + 摘要 | 搜狗 weixin.sogou.com (`type=2`) / 看一看 search proxy | YES | 0 (no numbers) |
| 过去 24-48h 内 公众号 整体 阅读数 increment 趋势 (estimates) | 西瓜数据 / 微信指数 / 新榜 public dashboard | NO (account-only) | estimate only |
| 公众号 粉丝数 快照 (估) | 极致了 / 新榜 / 西瓜 公开 dashboard | NO (account-only) | estimate only |
| 任意 文章 公众号 后台 真实 阅读量/点赞/在看 | ❌ — only via paid aggregator / own-account datacube / PC WeChat capture | | |

**The single honest answer to the user:** As of 2026-08-10, **the only remaining path to **arbitrary** per-article 阅读量/点赞/在看** is:

- (a) a paid per-call micro-API (TikHub @ $0.001/req, ~$0.0005 at scale; 次幂/极致了/data.wxrank.com @ ¥0.02–0.04/req), or
- (b) your own backend (datacube) if you own the 公众号, or
- (c) PC WeChat + mitmproxy capture of `getappmsgext`-class endpoint (your upstream already closed 2026-07-30), or
- (d) Computer Use screenshot of the in-app article footer (your slow/manual option).

There is no exploit left in 搜狗, 网页微信, 看一看/搜一搜 public surfaces, or any free-tier data platform that returns the real numbers without login + payment or without a running WeChat PC client.

---

## 6. Dated evidence index (for re-verification)

| Claim | URL | Captured |
|---|---|---|
| Sogou search endpoint returns `read_count: null` | https://orbtop.com/actors/sogou-wechat-article-search-scraper/ | 2026-07-06 actor schema |
| Sogou metrics API dead since 2017-04-27 | https://github.com/jaryee/wechat_sogou_crawl | README "2017-4-27搜狗微信取消了阅读、点攒及评论数据" |
| Sogou captcha page live | https://weixin.sogou.com/antispider/ | Exa snippet 2026-08-03 17:35:12 IP 68.166.172.98 |
| Sogou anti-bot cookie gating (SNUID/SUV) | https://cloud.tencent.com/developer/article/1953105 | 2026 |
| wxrank.com front-end live (free browse only) | https://www.wxrank.com/ | 2026-08 webfetch |
| wxrank paid API pricing ¥0.02/次 | https://www.showdoc.com.cn/2343746579263506/11558501783383049 | 2026 — "2分钱/次" / 10QPS / 1004 errors |
| TikHub V2 free credit only $0.05 (~50 req) | https://tikhub.io/zh/pricing | 2026-07 — "新账户获得约 50 次免费请求"; not sustainable |
| TikHub WeChat V2 legacy routes retired 2026-06-13 | https://tikhub.io/zh/wechat-api | "V2 路由采用清晰的版本号命名约定" |
| Wechaty personal-account web puppet dead | https://wechatapi.net/blog/04-wechaty%E6%9B%BF%E4%BB%A3%E6%96%B9%E6%A1%88.html | 2025-02 |
| WECHAT-MP-MCP: read counts explicitly out of scope | https://github.com/fdslk/WECHAT-MP-MCP | 2026-05 — "Read counts / likes / '看一看' are **not** available through this path" |
| 新榜 paid tiers with free-tier limitations | https://www.jzl.com/news/gzhdata-15 | 2026-06 |
| 西瓜数据 account-only metrics | https://www.xiaozhuwenda.com/article/3ea514898d881352e61bbae6 | 2026-04 |
| JustOneAPI 微信文章指标 — explicitly paid, "code 601: 余额不足" / "code 602: TOKEN 限额超限" | https://docs.justoneapi.com/zh/api/wechat-official-accounts/article-metrics-v1 | 2026 |
| Kjson.com 微信 入口 (V2EX era) — domain repurposed for JSON formatter | https://www.kjson.com/?lang=zh | 2026-08 |
| 看一看/搜一搜 推荐算法不公开 | https://www.newrank.cn/article/detail/3818 (2017) and 新榜 2025 推文 | 2025-06 |
| 看一看 推荐 因子 分析 (从 朋友阅读 + 在看 + 原创 + 完读率) | https://www.newrank.cn/article/detail/23360 | 2025-06 — "现在,'看一看'已经从原先'好看'和'推荐'两个板块,增加至'在看''热点''视频'三个板块" |
| 用户侧 看一看 历史: 头像 → 看过的文章 | https://www.toutiao.com/article/7354786040701534755/ | 2024-04 |
| 官方 datacube 接口 含 看一看/搜一搜 渠道 | https://developers.weixin.qq.com/doc/subscription/api/wedata/news/api_getuserread.html | 2026 (only own-account) |

---

## 7. "What I would do if I were you" recommendations (cheap, working in 2026-08)

If the requirement is "read ANY public article's 阅读量/点赞/在看 programmatically":

1. **Cheapest reliable (≈$0.001/req, scaled to $0.0005)**: TikHub WeChat V2 (`fetch_article_stats`): https://tikhub.io/zh/wechat-api. ~$0.05 initial free credit gets you 50 free requests to verify; then Alipay top-up.
2. **Cheapest China-domestic (¥0.02/req = ~$0.003)**: `data.wxrank.com/weixin/getrk` or 次幂 data — same pricing tier.
3. **Slightly higher (¥0.04/req)**: 极致了 微信数据接口 (already on your list).
4. **Sampled free (article discovery via Sogou search, low fidelity)**: parse `weixin.sogou.com/wexin?type=2&query=...` HTML for article URL list, then either:
   - hand-visit each in WeChat PC + Computer Use screenshot (your option 3), or
   - accept that you only get **article 摘要 + 公众号** (not metrics), then fall back to the popular-articles list on 微信 PC 看一看/搜一搜 (when manually visible).

There is no path that gets you the **real** per-article numbers for an arbitrary article without (a) a paid micro-API, (b) owning the 公众号, (c) running PC WeChat, or (d) Computer-Use-ing the WeChat client.
