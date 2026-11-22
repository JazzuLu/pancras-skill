# Pancras Skill Library

个人自写 AI Skill 库。所有 skill 的真身存放在此目录，通过软链接暴露给本机所有 AI 工具（Trae / Cursor / Gemini / Grok / Qoder / OpenCode 等）。

## Skill 列表

| Skill | 描述 | 创建日期 |
|-------|------|---------|
| `douyin-transcriber` | 使用本地 Whisper.cpp + Ollama 转录和润色抖音视频 | 2026-06 |
| `qa-loop` | QA 测试与修复循环：开启 QA 子代理测试，发现问题开修复子代理，迭代直到通过 | 2026-07-16 |
| `pr-review-loop` | PR 双轴 Review 与修复循环：Standards + Spec 并行 review，汇总风险后修复迭代 | 2026-07-16 |
| `wechat-extractor` | 批量提取公众号文章指标（阅读/赞/在看/正文/作者/图片）为统一 Markdown 格式。内容走 fetch.py 文本直抓（零视觉 token），指标走 Kimi cu 截图 footer；含环境自检、fallback 链与增量/汇总/下载图片增强 | 2026-08-07 |
| `mosh-tmux-remote` | 手机 Termux 经直连/中转用 mosh+tmux 连回工作主机：三模式决策树、端口与会话名锁定、手机复制即用命令、排错速查 | 2026-10-13 |
| `x-ego-send` | X 短帖/短链、长文 Article、评论区回复都只走本机 Ego 浏览器 | 2026-11-15 |
| `gemini-ego` | Gemini 网页版只走本机 Ego 浏览器：续对话提问、写稿、审稿、爆款标题、生图（含 `.ql-editor` 卡死等 live 实测坑） | 2026-11-22 |
| `wechat-mp-draft` | 公众号稿存草稿箱：API 优先（凭据在 `~/.secrets/wechat.env`），Ego 后台兜底，update 501 删了重建 | 2026-11-22 |

> `wechat-extractor/` 是本机独立 git 仓库，已单独托管在 `JazzuLu/wechat-extractor`，不纳入本仓库（见 `.gitignore`）。模型、`.venv`、抓包日志、本机全盘盘点报告同样不入库。

## 目录结构

```
pancras-skill/
├── README.md                ← 本文件
├── SKILL_INVENTORY.md       ← 全机 Skill 盘点报告
├── inventory_skills.py      ← 盘点脚本
├── douyin-transcriber/      ← 抖音转录 skill
│   ├── SKILL.md
│   ├── models/
│   └── scripts/
├── qa-loop/                 ← QA 测试循环 skill
│   └── SKILL.md
└── pr-review-loop/          ← PR Review 循环 skill
    └── SKILL.md
└── wechat-extractor/      ← 公众号文章批量提取 skill（仅公众号，已移除小红书）
    ├── SKILL.md            ← AI 客户端读取的主文件
    ├── README.md           ← 安装 / 使用 / 升级说明（面向人）
    ├── docs/
    └── scripts/
        ├── extract.py
        ├── fetch.py
        ├── check_env.py
        ├── download_images.py
        └── summarize.py
```

## 软链接目标

每个 skill 创建后会软链接到以下所有 AI skill 目录：

| AI 工具 | 目录路径 |
|---------|---------|
| Trae | `~/.trae/skills/` |
| Trae-CN | `~/.trae-cn/skills/` |
| Cursor | `~/.cursor/skills/` |
| Gemini | `~/.gemini/skills/` |
| Grok | `~/.grok/skills/` |
| Qoder | `~/.qoder/skills/` |
| OpenCode | `~/.opencode/skills/` |
| OpenCode Config | `~/.config/opencode/skills/` |
| Alma | `~/.config/alma/skills/` |

## 创建新 Skill 的流程

1. 在本目录下创建 `<skill-name>/SKILL.md`
2. SKILL.md 格式：
   ```markdown
   ---
   name: "<skill-name>"
   description: "<功能描述 + 触发条件>"
   ---

   # Skill: <标题>

   <详细说明>
   ```
3. 运行软链接脚本（见下方）
4. 更新本 README 的 Skill 列表
5. 记录到 Agent memory

## 软链接脚本

```bash
SKILL_SOURCE="/Users/pancraslu/WorkingPlace/Coding/AI/pancras-skill"
TARGET_DIRS=(
  "$HOME/.trae/skills"
  "$HOME/.trae-cn/skills"
  "$HOME/.cursor/skills"
  "$HOME/.gemini/skills"
  "$HOME/.grok/skills"
  "$HOME/.qoder/skills"
  "$HOME/.opencode/skills"
  "$HOME/.config/opencode/skills"
  "$HOME/.agents/skills"
  "$HOME/.claude/skills"
  "$HOME/.codex/skills"
  "$HOME/.pi/agent/skills"
  "$HOME/.config/alma/skills"
)

for skill in <skill-name>; do
  for dir in "${TARGET_DIRS[@]}"; do
    mkdir -p "$dir" 2>/dev/null
    ln -sf "$SKILL_SOURCE/$skill" "$dir/$skill" 2>/dev/null
  done
done
```

## Git

本目录托管在 GitHub 上，所有 skill 内容可公开共享。
