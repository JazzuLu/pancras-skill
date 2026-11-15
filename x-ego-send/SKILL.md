---
name: x-ego-send
description: >-
  Use when someone asks to publish or reply on X/Twitter from this Mac:
  发推, 短帖, 短链, 长文, X Article, 草稿箱, 存草稿, compose/post,
  compose/articles, 评论, 回复, quote, or editing an already published X post.
  Also use when an X send is about to go through the X API, grok-bot runner,
  Playwright, or a cloud browser.
allowed-tools:
  - Bash
  - Read
---

# X 发送（只走本机 Ego）

X 上的写入一律用本机已登录的 Ego 浏览器。不走 X API、tweepy、grok-bot `x-posting-plugin`、Playwright、云浏览器、kimi-cu。

先读 ego-browser skill（本机各 Agent 的 skills 目录下都有 `ego-browser`；不要写死某台机器的绝对路径）。按它的指引跑 `ego-browser skill`，浏览器 API 以当时输出的指南为准；本 skill 只规定 X 的页面和坑。

## 总闸

- 只有当前请求明确要**发出去**才点 Post / Publish / Reply。只写稿、只看，就停在编辑器。
- 茶馆工作区里：先把逐字定稿给用户看，用户回「发」才点，一次一条。当前这条消息本身已经是用户的「发」并且带了逐字稿，就直接发，不要再问一次。
- 正文、标题、评论逐字用调用方给的文本。不润色、不加 hashtag、不顺便 @。
- 素材放「素材放哪」一节规定的目录。不要把图、音频、稿子丢进 `~/Downloads`，也不要放进 skill 目录。
- 一次只发请求里的那一条。不点赞、不关注、不转发，不动其他草稿和别人的帖。
- 默认账号是 Ego 里已登录的 `@pancraslu89217`。页面不是这个号，或跳出登录墙：停，不要登录、不要清 cookie。
- 整个任务一个 `taskSpace`，复用 `p1`。每轮脚本结束前打印 `spaceId` 和 `page.url()`。不熟的按钮先 `snapshot()`，用当下的 ref，不要靠过期 ref。
- 文件一律绝对路径。粘贴用 `page.keyboard.paste`，不要对正文 `fill()`。
- 发出去了，打开结果页复核，回报 `https://x.com/<handle>/status/<id>`。只存草稿，回报草稿地址，不要报成已发布。做完 `await task.finish({ keep: [] })`，且这轮里不再操作页面。

## 草稿还是发出去

没有明确说「发 / 发布」，默认只进草稿箱，不点 Post / Publish / Reply。

| 调用方要的 | 做到哪停 |
|---|---|
| 存草稿、放草稿箱、先别发，或没说发 | 写完停在草稿，回报草稿地址 |
| 发、发布，并且当前消息就是这次「发」 | 先落进草稿并核对，再点发布 |

两个草稿箱不通用：长文在 Articles 的 Drafts，短帖在作曲框自己的 Drafts。不要把短帖写进 Article 草稿，也不要把长文当短帖草稿。评论没有这个草稿箱；没说发就不要回。

## 选哪条

| 要发的 | 打开 |
|---|---|
| 短帖、短链、普通 X 发送 | `https://x.com/compose/post` |
| 长文 / X Article，含只存草稿 | `https://x.com/compose/articles` |
| 评论区回复 | 调用方给的那条 status URL，不要自己搜一篇像的 |

引用转发只有调用方写明「引用 / quote」才做。不要用引用代替评论。

## 素材放哪

skill 目录只放代码和说明，不放用户的图和稿子。素材放**工作区内一个固定属于本 skill 的目录**：`./x-ego-send/<yyyymmdd>-<slug>/`。

别人的仓库目录长什么样都无关，因为本 skill 只认自己这个名字的目录，不猜 `content/`、`assets/`、`drafts/` 之类。

- **工作区** = 当前内容归属的仓库根（含 `.git` 的目录）。会话没绑项目、或 cwd 是聊天/临时目录：先找到内容归属的仓库，不要用临时 cwd。
- 调用方显式给了路径：绝对路径原样用，相对路径按工作区根解析。这是茶馆要把稿子放进 `content/03-drafts/` 时的做法。
- 不设全局 home，不写 `~/.local/share`。

```
x-ego-send/<yyyymmdd>-<slug>/
  title.txt      标题，单独一行
  body.txt       正文，段落间单个空行
  image/         正文配图、音频等资源
  cover.png      封面，可选
  scripts/       本次用到的脚本
  status.txt     发出后的 status URL，回写一份
```

- `slug` 用英文 kebab-case，从标题或调用方给的 id 来。
- 不用 `~/Downloads`。那是人的下载区，会被清。
- 绝对路径写进脚本；调用方给相对路径，先按工作区根解析成绝对路径。
- 同一篇改稿或重发：往同一个目录加 `body-v2.txt`，不覆盖 `body.txt`。不删、不改已发布单元里的任何文件。
- 复核截图落 `$TMPDIR`，看完删。用户要留证据才拷进 `image/`。

## 短帖 / 短链

1. 打开 `https://x.com/compose/post`，snapshot。
2. 点作曲框（常见 `data-testid="tweetTextarea_0"`，没有就用 snapshot 里的文本框）。`keyboard.paste` 原文。短链就是把给出的 URL 原文贴进去，不要配文。
3. 有图：对文件控件 `setInputFiles`，或先 `waitForFileChooser()` 再点媒体按钮、`setFiles`。路径必须已存在。
4. 只存草稿：不要点 Post。snapshot 里找作曲框自己的 Drafts / Save draft，把这一条存进去。然后打开该入口，确认列表里有刚才的原文。页面上没有这个入口：停，说明找不到短帖草稿箱，不要关掉页面碰运气，也不要改去存成 Article。
5. 要发出去才点这篇的 Post（常见 `data-testid="tweetButton"`）。不要点侧栏那个会新开作曲框的 Post，除非当前页就是作曲页且按钮明确属于这篇。
6. 从成功提示或个人主页拿到 status URL，打开确认文字和图片都在。

## 长文（X Article）

已在 2026-11-15 用 Ego 发过并改过一篇。编辑器是 Draft.js，空行会变成空段块，发出去就是段间多一整行空白。

1. 打开 `https://x.com/compose/articles`。新建点 `aria-label="create"`。要改已有稿就打开给出的 `/compose/articles/edit/<id>`，不要再点 create。
2. 等到标题框和 `div[contenteditable="true"]` 都在。标题框常见 `textarea[name="Article Title"]`。
3. 标题只填标题框。正文里删掉单独一行的 `标题：…`。
4. 粘贴前处理正文，再整段 `keyboard.paste`：
   - 去掉段落之间的空行。每个非空行会变成一块；留着 `\n\n` 就会多出空块。
   - 配图占位行 `【配图位置：…】` 不要贴进正文。记下它前后两句，用来对位置。
   - `**` 和 ` ``` ` 只删标记、留文字。代码行首的 `#` 多半是 shell 注释，保留。
5. 核对：编辑器里非空文本块按行拼起来，和准备好的正文逐行一致。不一致就停，不要发，也不要当成草稿已好。
6. 配图走 **Add Media → Media → `setInputFiles`**，插在占位行原本的位置（上一句之后、下一句之前）。确认只有这一张图，位置对，再继续。不要用顶上那个 5:2 的封面上传当正文配图。
7. 调用方点名要加粗的行，才用工具栏加粗。不加粗不算出错。
8. 等侧栏从 Saving 变成 Last saved。这就是草稿箱：没有另外的保存按钮。只存草稿就停在这里，不点 Publish。回到 `https://x.com/compose/articles` 的 Drafts 标签，确认卡片标题就是这一篇，回报编辑地址 `https://x.com/compose/articles/edit/<id>`。不要再点一次 create。
9. 要发出去才点 Publish。受众和谁可以回复都用 Everyone，除非调用方另有指定。
10. 看到 Article 已发布后，打开 status 页复核：标题、首段、配图张数和位置、末句都在；正文没有 `**`、代码围栏、`[!--`，也没有连续空行。

## 评论区

1. 只打开调用方给的那条 status URL。
2. snapshot，点这条帖自己的 Reply。不要点 Repost、Like，也不要点进文章正文。
3. 在**这条回复框**里 `keyboard.paste`。提交按钮是这个框的 Reply / Post，不是侧栏的 Post。
4. 确认这句话出现在该帖下面。能拿到回复自己的 status URL 就一并回报。只回这一条。

## 改已经发出去的

- **Article 不能就地编辑。** 从 Articles 列表或编辑 URL 进已发布篇，点 **Unpublish, move to drafts**，改完再 Publish。公开链接中间会短暂打不开；正常情况 status URL 不变，仍以页面上读到的为准。
- 没有 Unpublish、改不动：停下来说明。不要 Delete Article，不要删掉重发。
- 短帖如果页面没有 Edit：同样停，不要删了重发。

## 不要做

- 不要用 API 或 grok-bot 发车脚本顶替 Ego。那条发车是短帖队列，而且锁着，不会发 Article。
- 不要新开第二个 taskSpace 来摆脱卡住的页面。
- 不要为了「好看」把空行加回去，也不要改调用方没有点名的字。
