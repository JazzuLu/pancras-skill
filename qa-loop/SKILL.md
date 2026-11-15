---
name: qa-loop
description: 提交后、PR 前的 QA 测试与修复循环，最多 2 轮。
---

# Skill: QA 测试与修复循环（QA Loop）

## 核心理念

代码修改完成后，**不直接创建 PR**，而是先开启 QA 子代理测试功能，发现问题后开启修复子代理修复，来回迭代直到所有测试通过。这是一种"测试驱动合并"的理念。

## 适用场景

- 代码修改完成，需要验证功能正确性
- PR 创建前或合并前的质量门禁
- 修复 bug 后需要回归验证
- 新功能开发完成后的端到端测试

## 核心流程

```
┌─────────────────────────────────────────────────┐
│  1. 确认服务就绪（前端 + 后端 + 数据库）          │
│  2. 开启 QA 子代理（测试）                       │
│  3. QA 子代理报告问题？                           │
│     ├─ 是 → 开启修复子代理 → 回到步骤 2          │
│     └─ 否 → QA Loop 完成，可以创建 PR            │
└─────────────────────────────────────────────────┘
```

## 项目特定配置

**⚠️ 本 skill 是通用的，不包含任何项目特定的 URL、端口、登录方式、环境配置等配置。**

缺失时用默认值先跑，不要一次拦齐 9 项：前后端地址和启动命令从项目 AGENTS.md 取，取不到则跳过对应检查并注明。

使用前请从以下来源获取项目特定配置：
1. **项目 memory**：`project_memory.md` 中通常记录了登录方式、服务地址、启动命令等
2. **项目 AGENTS.md**：记录了服务运行方式（如 tmux session 名、端口、启动脚本）
3. **项目 local 目录**：本地环境变量文件、启动脚本等

你需要收集以下信息才能运行 QA Loop：

| 配置项 | 占位符 | 说明 |
|--------|--------|------|
| 前端地址 | `<frontend-url>` | 如 `http://127.0.0.1:3000` |
| 后端地址 | `<backend-url>` | 如 `http://127.0.0.1:8080` |
| 健康检查路径 | `<health-check-path>` | 如 `/health`、`/swagger-ui/index.html`、`/api/health` |
| Mock 登录 URL | `<mock-login-url>` | 本地开发的免登录 URL（如存在） |
| 登录 cookie 文件 | `<cookie-file>` | 如 `/tmp/c.txt` |
| 前端启动命令 | `<frontend-start>` | 如 `pnpm dev`、`npm run dev`、`yarn dev` |
| 后端启动命令 | `<backend-start>` | 如 `./mvnw spring-boot:run`、`python manage.py runserver`、`go run main.go` |
| 环境变量文件 | `<env-file>` | 后端启动需要 source 的文件 |
| Tmux session 名 | `<tmux-session>` | 服务运行的 tmux session |

## 步骤详解

### 步骤 1：确认服务就绪

在启动 QA 子代理前，**必须**确认所有服务正常运行：

```bash
# 检查后端
curl -s -o /dev/null -w "backend: HTTP %{http_code}\n" <backend-url><health-check-path>

# 检查前端
curl -s -o /dev/null -w "frontend: HTTP %{http_code}\n" <frontend-url>

# 检查 tmux session（如使用 tmux 管理服务）
tmux list-panes -t <tmux-session> -F "#{pane_index}: #{pane_current_command} #{pane_current_path}"
```

**⚠️ 坑 1：前端服务可能已挂掉**
- 现象：QA 子代理报告 `ERR_CONNECTION_REFUSED`
- 原因：前端 dev server 进程可能已退出（崩溃、tmux pane 被意外关闭等）
- 解决：检查 tmux session 中的前端 pane，必要时重启 `<frontend-start>`

**⚠️ 坑 2：后端环境配置未激活**
- 现象：mock-login 端点或特定功能返回 404
- 原因：后端启动时未 source 环境变量文件，特定环境配置未激活
- 解决：`source <env-file> && <backend-start>`，确保正确环境配置激活

**⚠️ 坑 3：后端代码修改后未重启**
- 现象：修改后端代码后测试仍走旧逻辑
- 原因：应用框架通常不会热重载配置文件和大部分代码变更
- 解决：修改后端代码后**必须重启**后端服务

### 步骤 2：开启 QA 子代理

根据测试类型选择子代理类型：

| 测试类型 | 子代理类型 | 适用场景 |
|---------|-----------|---------|
| 浏览器 UI 测试 | `browser_use` | 需要点击、截图、验证页面元素 |
| API 测试 | `general_purpose_task` | 需要调用 API、检查响应 |
| 源码审查 | `general_purpose_task` | 需要读取代码、验证逻辑 |
| 混合测试 | `general_purpose_task` | 以上多种组合 |

**⚠️ 坑 4：browser_use 子代理无登录态**
- 现象：browser_use 子代理访问页面被重定向到登录页
- 原因：browser_use 使用独立 Chromium，没有用户系统浏览器的登录 cookie
- 解决：使用项目的本地登录方式（如 mock-login URL）先获取登录态
  ```bash
  # 先访问 mock-login 获取 cookie（如项目支持）
  curl -sS -c <cookie-file> '<mock-login-url>' >/dev/null
  # 或在 browser_use 中先 navigate 到 mock-login URL
  ```
- **注意**：mock-login 端点可能需要特定环境配置激活，admin 权限可能需要额外配置。具体请参考项目 memory

**⚠️ 坑 5：browser_use 子代理 step budget 耗尽**
- 现象：复杂测试场景（如多步表单填写）在 60 步内无法完成
- 原因：browser_use 子代理有 step budget 限制（通常 60 步）
- 解决：
  1. 拆分测试任务，每个子代理只测一个功能点
  2. 对于需要认证的 API 测试，用 `curl -b cookie` 替代浏览器操作
  3. 对于纯源码验证，用 `general_purpose_task` 子代理读取代码

### 步骤 3：QA 子代理报告处理

QA 子代理的测试报告应包含：
- **状态**：PASS / FAIL / BLOCKED
- **证据**：截图、curl 输出、代码引用
- **问题描述**：如果 FAIL/BLOCKED，说明具体问题

根据报告结果：
- **全 PASS** → QA Loop 完成，可以创建 PR
- **有 FAIL** → 开启修复子代理，修复后回到步骤 2（同一问题最多迭代 2 轮；2 轮未过则汇总阻塞点交由人工决策）
- **有 BLOCKED** → 分析阻塞原因（服务不可达、登录问题等），解决后回到步骤 2（同一阻塞最多重试 2 次）

### QA 子代理 Prompt 模板

```
你是 QA 测试代理，需要验证 [功能描述]。

## 环境
- 前端：<frontend-url>
- 后端：<backend-url>
- 本地登录 URL：<mock-login-url>（如存在）

## 登录方法
[根据项目实际情况填写，如：先 navigate 到 mock-login URL 完成登录，然后 navigate 到前端页面]

## 测试任务
[具体测试步骤]

## 输出要求
### 测试一：[测试名称]
- 状态：PASS / FAIL / BLOCKED
- 发现：
- 截图/证据：

### 问题汇总
（如有问题，列出具体问题描述、复现步骤、建议修复方案）

### 结论
- 是否可以合并：是 / 否
```

### 修复子代理 Prompt 模板

```
你是修复子代理。QA 测试发现以下问题：

## 问题描述
[从 QA 报告中提取的问题]

## 修复要求
1. 在 [项目路径] 下修改代码
2. 修复后运行验证：[验证命令]
3. 验证通过后提交：git add -A && git commit --no-verify -m "fix: [描述]"
4. git push

## 输出
报告你做了什么、验证结果、提交信息。
```

## 经验与教训

### 经验 1：curl 是浏览器测试的有效替代

当 browser_use 子代理因登录限制或预算耗尽无法完成测试时，可以用 curl 替代：

```bash
# 1. 获取登录态（如项目支持 mock-login）
curl -sS -c <cookie-file> '<mock-login-url>' >/dev/null

# 2. 用 cookie 测试 API
curl -sS -b <cookie-file> -X POST '<backend-url>/api/v1/resource' \
  -H 'Content-Type: application/json' \
  -d '{"name":"test"}' | jq .
```

### 经验 2：源码审查作为补充验证

当浏览器测试受阻时，可以通过源码审查验证修改正确性：
- 确认修改的文件和行号
- 确认修改逻辑符合预期
- 确认没有引入新的副作用

### 经验 3：预存基线问题需排除

某些测试失败可能是目标分支上已存在的基线问题，**非本次修改引入**。验证方法：

```bash
# 切到目标分支跑同一个测试
git stash && git checkout <target-branch> -- <changed-files>
<test-command>
git checkout <branch> -- <changed-files> && git stash pop
```

### 经验 4：测试报告要结构化

要求子代理输出结构化报告（PASS/FAIL/BLOCKED + 证据），便于决策是否需要修复迭代。

### 经验 5：后端重启的标准流程

```bash
# 1. kill 旧进程
lsof -t -iTCP:<backend-port> -sTCP:LISTEN | xargs kill 2>/dev/null
sleep 3

# 2. 用正确环境配置重启
source <env-file> && cd <backend-dir> && <backend-start>

# 3. 等待启动完成（检查健康端点）
sleep 40 && curl -s -o /dev/null -w "HTTP %{http_code}\n" <backend-url><health-check-path>
```

## 文件结构

```
pancras-skill/qa-loop/
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
