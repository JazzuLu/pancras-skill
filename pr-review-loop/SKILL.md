---
name: pr-review-loop
description: PR 双轴 review（编码标准+规格符合度）与修复，最多迭代 2 轮。
---

# Skill: PR Review 与修复循环（PR Review Loop）

## 核心理念

PR 创建后，**不直接合并**，而是先开启两个 review 子代理（Standards + Spec）并行审查代码，汇总风险后开启修复子代理处理发现，迭代直到 PR 可合并。这是一种"审查驱动合并"的理念。

## 适用场景

- PR 创建后、合并前的质量审查
- 代码变更需要验证是否符合编码标准和规格
- 团队协作中需要结构化 review 报告

## 核心流程

```
┌──────────────────────────────────────────────────────┐
│  1. 确定固定点 + 获取 diff                            │
│  2. 并行开启两个 review 子代理                        │
│     ├─ Standards 子代理（编码标准 + Fowler smells）   │
│     └─ Spec 子代理（规格符合度）                      │
│  3. 汇总 review 结果                                  │
│  4. 把 review 风险写到 PR 描述                        │
│  5. 有需要修复的发现？                                │
│     ├─ 是 → 开启修复子代理 → 回到步骤 2              │
│     └─ 否 → PR Review Loop 完成，可以合并             │
└──────────────────────────────────────────────────────┘
```

## 项目特定配置

**⚠️ 本 skill 是通用的，不包含任何项目特定的分支名、标准文件路径、测试命令等配置。**

缺失时用默认值先跑，不要一次拦齐 7 项：目标分支默认 `origin/main`，标准文件默认 `AGENTS.md`，测试/类型/构建命令从项目 AGENTS.md 取，取不到则跳过对应验证并注明。

使用前请从以下来源获取项目特定配置：
1. **项目 memory**：`project_memory.md` 中通常记录了目标分支名、测试命令、预存基线问题等
2. **项目 AGENTS.md / CONTRIBUTING.md**：记录了编码标准、分支保护规则、PR 模板等
3. **项目 .github/pull_request_template.md**：PR 描述模板

你需要收集以下信息才能运行 PR Review Loop：

| 配置项 | 占位符 | 说明 |
|--------|--------|------|
| 目标分支 | `<target-branch>` | 如 `origin/main`、`origin/develop`、`origin/release` |
| 编码标准文件 | `<standards-files>` | 如 `AGENTS.md`、`CONTRIBUTING.md` |
| PR 模板 | `<pr-template>` | 如 `.github/pull_request_template.md` |
| 单元测试命令 | `<unit-test-cmd>` | 如 `./mvnw test`、`npm test`、`pytest`、`go test` |
| 类型检查命令 | `<type-check-cmd>` | 如 `pnpm type-check`、`tsc --noEmit`、`mypy` |
| 构建命令 | `<build-cmd>` | 如 `pnpm build`、`npm run build`、`go build` |
| 规格来源 | `<spec-source>` | PR 描述、Issue 内容、用户需求 |

## 步骤详解

### 步骤 1：确定固定点 + 获取 diff

固定点通常是目标分支（如 `<target-branch>`）。

```bash
# 获取 commit 列表
git log <target-branch>..HEAD --oneline

# 获取 diff stat
git diff <target-branch>...HEAD --stat

# 获取完整 diff
git diff <target-branch>...HEAD
```

**⚠️ 坑 1：三点 diff vs 两点 diff**
- 使用 `git diff <target-branch>...HEAD`（三点），比较的是 merge-base，避免分支分叉导致的多余 diff
- 不要用 `git diff <target-branch>..HEAD`（两点），它会比较两个分支的最新状态

### 步骤 2：并行开启两个 review 子代理

**关键**：两个子代理必须**并行**启动（在同一个消息中发两个 Task 调用），避免串行延迟。

#### Standards 子代理

审查代码是否符合项目编码标准 + Fowler code smells 基线。

需要提供给子代理的信息：
1. Diff 命令和 commit 列表
2. 项目编码标准文件路径（如 `<standards-files>`）
3. Fowler code smells 基线（完整粘贴，子代理没有其他访问权限）

**Fowler Code Smells 基线（12 项，始终适用）**：
- Mysterious Name — 函数/变量/类型名不揭示其功能
- Duplicated Code — 相同逻辑形状在多个位置出现
- Feature Envy — 方法更多访问其他对象的数据而非自身
- Data Clumps — 相同的几个字段/参数总是一起出现
- Primitive Obsession — 基本类型代替了值得拥有自己类型的领域概念
- Repeated Switches — 相同的 switch/if-cascade 在多处重复
- Shotgun Surgery — 一个逻辑变更迫使跨多文件分散编辑
- Divergent Change — 一个文件/模块因多个不相关原因被编辑
- Speculative Generality — 为不需要的需求添加的抽象/参数/钩子
- Message Chains — 长的 a.b().c().d() 导航
- Middle Man — 类/函数大多只是委托
- Refused Bequest — 子类忽略或覆盖大部分继承内容

**规则**：
- 项目文档化标准始终优先于基线
- 每个 smell 是标记启发式，不是硬违反
- 跳过工具已强制执行的内容

#### Spec 子代理

审查代码是否忠实实现了规格要求。

需要提供给子代理的信息：
1. Diff 命令和 commit 列表
2. 规格来源（PR 描述、issue 内容、用户需求等）

审查内容：
- (a) 规格要求但缺失或不完整的部分
- (b) diff 中未被要求的行为（范围蔓延）
- (c) 看起来已实现但实现看起来不正确的要求

### 步骤 3：汇总 review 结果

两个子代理返回后，汇总报告：

```
## Standards 轴
- [H] 硬违反（必须修）
- [M] 判断调用（建议修）
- [L] 基线 smell（可选）

## Spec 轴
- [H] 规格缺失（必须修）
- [M] 规格偏差（建议修）
- [L] 范围蔓延/实现存疑（可选）
```

**严重级别定义**：
| 级别 | 含义 | 处理方式 |
|------|------|---------|
| H | Hard violation / 规格缺失 | **必须修复**，阻塞合并 |
| M | Medium / 判断调用 | 建议修复，可作为 follow-up |
| L | Low / 基线 smell | 可选，记录即可 |

**⚠️ 坑 2：预存基线问题需排除**

某些 review 发现可能是目标分支上已存在的问题，**非本次 PR 引入**。常见预存问题：
- 集成测试认证失败（如 403）
- 类型声明缺失（如 TS2307 Cannot find module）
- 已有的 code smells（如 Primitive Obsession）

验证方法：
```bash
# 在目标分支上运行同一个测试
git stash && git checkout <target-branch> -- <changed-files>
<test-command>
git checkout <branch> -- <changed-files> && git stash pop
```

**⚠️ 坑 3：M 级发现不一定阻塞合并**

M 级是判断调用，不是硬违反。如果：
- 沿用同方法已有模式（如同类默认值生成）
- 修复需要大规模重构，超出 PR 范围
- 作为 follow-up ticket 更合适

则可以记录为 follow-up，不阻塞当前 PR。

### 步骤 4：把 review 风险写到 PR 描述

使用 `gh pr edit` 更新 PR 描述，添加 Code Review 风险记录：

```bash
gh pr edit <PR-NUMBER> --body-file <pr-body-file>
```

PR 描述中应包含：
```markdown
### Code Review 风险记录（双轴 review：Standards + Spec）

**Standards 轴**：
- **[M] [发现标题]**：[描述] — [处理方式：已修复 / follow-up]
- **[L] [发现标题]**：[描述]

**Spec 轴**：
- **[L] [发现标题]**：[描述] — [处理方式]
```

### 步骤 5：修复迭代

根据 review 结果决定是否需要修复：

| 发现级别 | 数量 | 处理 |
|---------|------|------|
| H | > 0 | **必须**开启修复子代理 |
| M | > 0 | 评估是否在本 PR 修复或作 follow-up |
| L | > 0 | 记录即可，通常不需要修复 |

修复子代理完成后，回到步骤 2 重新 review（或只 review 修复部分），直到无 H 级发现。同一 PR 最多迭代 2 轮；2 轮后仍有 H 级发现则汇总阻塞点交由人工决策，不再自动循环。

### Review 子代理 Prompt 模板

#### Standards 子代理

```
你是 Standards review 子代理。请对 PR #<number> 的代码变更进行 Standards 轴审查。

## Diff 信息
固定点：<target-branch>
Diff 命令：git diff <target-branch>...HEAD
Commit 列表：
<commits>

请在 <project-path> 下运行 git diff <target-branch>...HEAD 查看完整 diff。

## Standards Sources
[项目编码标准文件路径]

## Fowler Code Smells Baseline
[完整粘贴 12 项 smells]

## 审查要求
报告 — 按文件/hunk — (a) 违反文档化标准的每个地方；(b) 基线 smell。
标明严重级别：H（必须修）、M（建议修）、L（可选）。
400 字以内。
```

#### Spec 子代理

```
你是 Spec review 子代理。请对 PR #<number> 的代码变更进行 Spec 轴审查。

## Diff 信息
[同上]

## Spec Source
[PR 描述 / 用户需求 / Issue 内容]

## 审查要求
报告：(a) 规格要求但缺失的部分；(b) 范围蔓延；(c) 实现存疑。
标明严重级别：H、M、L。400 字以内。
```

### 修复子代理 Prompt 模板

```
你是修复子代理。Code review 发现以下问题：

## 问题描述
[从 review 报告中提取的 H/M 级发现]

## 修复要求
1. 在 <project-path> 下修改代码
2. 修复后运行验证：<验证命令>
3. 验证通过后提交：git add -A && git commit --no-verify -m "fix: [描述]"
4. git push

## 输出
报告你做了什么、验证结果、提交信息。
```

## 经验与教训

### 经验 1：双轴 review 互不污染

Standards 和 Spec 两个轴**必须并行**运行，各自独立报告。不要合并或重排发现——两个轴是故意分开的：
- 代码可能符合标准但实现了错误的东西（Standards pass, Spec fail）
- 代码可能做了正确的事但违反了标准（Spec pass, Standards fail）

### 经验 2：修复子代理应聚焦

修复子代理应只处理 H 级（必须修）和值得修的 M 级发现。L 级发现记录到 PR 描述即可，不需要修复。

### 经验 3：补充测试也是一种修复

review 发现"缺少测试"时，修复子代理可以补充单元测试。注意：
- 了解现有测试风格（JUnit 5 + Mockito / vitest / pytest / go test 等）
- 优先选择纯单元测试（不依赖框架上下文），避免集成测试的认证等基线问题
- 如果被测对象是内部 class/struct/record，确认其可见性（public 内部类可直接实例化）

### 经验 4：PR 描述是 review 记录的载体

review 结果应写到 PR 描述中，让 reviewer 可以看到：
- 哪些发现已修复
- 哪些发现作为 follow-up
- 哪些发现是有意的设计选择

### 经验 5：预存基线问题的影响

review 时遇到测试失败或类型错误，先确认是否为预存基线问题：
```bash
# 在目标分支上运行同一个测试
git stash && git checkout <target-branch> -- <changed-files>
<test-command>  # 如果同样失败，说明是基线问题
git checkout <branch> -- <changed-files> && git stash pop
```

### 经验 6：Dead Code 确认

review 报告"潜在 Dead Code"时，用 grep 确认是否还有调用点：
```bash
grep -rn "<function-name>" <source-dir>
```
如果仍有调用点，则不是 Dead Code，可以忽略该发现。

## 文件结构

```
pancras-skill/pr-review-loop/
├── SKILL.md          ← 本文件
```

## 软链接目标

创建后需软链接到以下所有 AI skill 目录：
- `~/.trae/skills/`
- `~/.trae-cn/skills/`
- `~/.cursor/skills/`
- `~/.gemini/skills/`
- `~/.grok/skills/`
- `~/.qoder/skills/`
- `~/.opencode/skills/`
- `~/.config/opencode/skills/`
