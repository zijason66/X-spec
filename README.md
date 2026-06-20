# x-spec SDD规范驱动开发框架

> **Spec-Driven Development** — 集成 OpenSpec 规范引擎与 SuperPowers 执行引擎

## 概述

x-spec 是一套SDD（Spec-Driven Development）规范驱动开发框架，核心理念是 **"先对齐再构建"（Agree before you build）**——在编写任何代码之前，先就"要构建什么"达成一致。

### 设计哲学

| 原则 | 说明 |
|------|------|
| **流动灵活** | 非僵硬死板，足够好的计划就动手 |
| **迭代式** | 非瀑布式，持续演进规范 |
| **规范即代码** | 规范随代码一同提交至Git，作为活文档持久存在 |
| **棕地优先** | 面向已有成熟代码库，而非假设从零开始 |
| **知识先行** | 在SDD开发前注入项目知识上下文（MCP / 本地文档 / 人工），确保基于完整理解 |
| **流程模板化** | 作业流程以YAML模板保存，简化理解与配置 |

## 五大核心能力

### 1. 系统初始化配置 (Init)
对原有系统进行SDD初始化配置，创建规范目录结构、生成默认配置和流程模板。

```bash
x-spec init --path /path/to/project --profile standard
```

初始化后自动创建 `templates/workflows/` 目录，包含三个YAML流程模板：
- `sdd-standard.yml` — SDD标准流程（6阶段）
- `sdd-quick.yml` — SDD快速流程（4阶段，跳过知识注入和审查）
- `sdd-full.yml` — SDD完整流程（7阶段，含设计评审和集成验证）

### 2. 知识注入 (Knowledge) — SDD前置阶段
在需求开始阶段注入项目知识上下文，支持三种方式，按优先级自动降级：

| 优先级 | 方式 | 说明 |
|--------|------|------|
| **1（最高）** | MCP 注入 | 通过外部 MCP 服务器自动拉取知识（如 Confluence、Notion、内部 Wiki） |
| **2** | 本地文档归档 | 从配置的本地文档路径自动读取归档知识文件 |
| **3（兜底）** | 人工交互注入 | 仅当前两种方式均不可用时，通过交互提示手动输入 |

```bash
x-spec knowledge                              # 自动检测可用方式，按优先级执行
x-spec knowledge --source mcp                 # 强制使用 MCP 注入
x-spec knowledge --source local               # 强制从本地文档路径读取
x-spec knowledge --source manual              # 强制人工交互注入
x-spec knowledge --category business          # 仅注入指定分类
x-spec knowledge --category tech-stack
x-spec knowledge --category api
x-spec knowledge --category sdk
```

**MCP 注入配置**（`x-spec.yml`）：
```yaml
knowledge:
  mcp:
    enabled: true
    server: "your-mcp-server-url"   # MCP 服务器地址
    tools:
      - fetch_confluence_page
      - fetch_notion_doc
```

**本地文档归档配置**（`x-spec.yml`）：
```yaml
knowledge:
  local-docs:
    enabled: true
    paths:
      - docs/business/        # 业务文档目录
      - docs/api-reference/   # API 文档目录
      - docs/sdk/             # SDK 文档目录
    glob: "**/*.md"           # 匹配文件模式
```

### 3. 流程串接执行 (Run)
按默认SDD流程模板串接执行，自动完成 知识注入→提案→审查→实现→验证→归档。

```bash
x-spec run                                # 使用默认SDD标准流程
x-spec run --template sdd-quick           # 使用快速流程
x-spec run --template sdd-full            # 使用完整流程
x-spec run --description "添加用户认证"     # 带变更描述
x-spec run --dry-run                      # 仅展示执行计划
x-spec run --from propose                 # 从指定阶段开始
```

### 4. 作业流编排 (Workflow)
支持从流程模板编排自定义作业流，也支持手动创建和编辑YAML文件。

```bash
# 查看可用流程模板
x-spec workflow templates

# 从模板编排自定义作业流
x-spec workflow compose my-flow --template sdd-standard
x-spec workflow compose --interactive      # 交互式选择阶段

# 管理作业流
x-spec workflow create my-flow --description "自定义作业流"
x-spec workflow list
x-spec workflow validate my-flow
x-spec workflow run my-flow
```

### 5. 代码仓库模板化处理 (Template)
将原有代码仓库提取为可复用模板，支持变量占位符和模板应用。

```bash
x-spec template extract ./src --name service-template
x-spec template apply service-template --output ./generated --var packageName=com.new.pkg
```

## SDD工作流（含知识注入阶段）

```
知识注入 → 发起提案 → 评审修正 → 执行编码 → 验证一致性 → 归档更新规范
```

| 阶段 | 命令 | 说明 |
|------|------|------|
| **1. 知识注入** | `x-spec knowledge` | 自动从 MCP / 本地文档归档获取，均不可用时转人工交互注入 |
| **2. 变更提案** | `x-spec propose <描述>` | 生成proposal + design + tasks + knowledge-ref + specs |
| **3. 人工审查** | 手动 | 审查提案文档，确保方向正确 |
| **4. 执行实现** | `x-spec apply [变更名]` | 执行层：brainstorm→plan→execute(subagent)→finish，TDD纪律驱动 |
| **5. 验证一致性** | `x-spec verify [变更名]` | 验证实现与规范一致性 |
| **6. 归档** | `x-spec archive [变更名]` | 归档变更，合并规范增量 |
| **一键执行** | `x-spec run` | 按流程模板串接执行全流程 |

## 三层架构

x-spec 采用三层分离设计，规格层锁定意图，执行层驱动实现，宿主层承载流程：

```
┌─────────────────────────────────────────────────────┐
│                  规格层 (OpenSpec)                    │
│  propose → spec → design → tasks                    │
│  产出: proposal.md / specs/ / design.md / tasks.md  │
│  职责: 锁定意图，管理变更，增量规范                     │
└──────────────────────┬──────────────────────────────┘
                       │ 桥接（架构师/开发者审查传递）
                       ▼
┌─────────────────────────────────────────────────────┐
│                执行层 (Superpowers)                   │
│  brainstorm → plan → execute(subagent) → finish     │
│  产出: specs/*.md / plans/*.md / code / tests       │
│  职责: TDD 纪律，子代理驱动，代码审查                   │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│               宿主层 (Claude Code / Cursor)           │
│  slash commands / subagents / skill discovery        │
│  职责: 流程承载，上下文注入，代理协作                    │
└─────────────────────────────────────────────────────┘
```

### 规格层 (OpenSpec)

规格层负责**锁定意图**，在编码前产出完整的变更文档集，作为执行层的输入契约。

| 步骤 | 产出文件 | 说明 |
|------|---------|------|
| `propose` | `proposal.md` | 变更动机、范围、验收标准 |
| `spec` | `specs/*.md` | 功能规范，Given-When-Then 场景定义 |
| `design` | `design.md` | 技术方案、接口设计、模块拆分 |
| `tasks` | `tasks.md` | 原子化任务清单，带依赖关系与优先级 |

规格层输出存放于 `openspec/changes/<change-name>/`，经人工审查后传递给执行层。

### 执行层 (Superpowers)

执行层接收规格层审查通过的 `tasks.md`，以 **TDD 纪律 + 子代理驱动** 的方式完成编码实现。

#### 执行阶段

```
brainstorm → plan → execute(subagent) → finish
```

| 阶段 | 触发命令 | 职责 | 产出 |
|------|---------|------|------|
| **brainstorm** | `/brainstorm` | 发散探索实现路径，评估技术风险，选定方案 | `specs/<feature>.md` |
| **plan** | `/plan` | 将 tasks.md 细化为带 TDD 节拍的执行计划 | `plans/<task>.md` |
| **execute** | `/execute` | 子代理逐任务执行：先写测试，再写实现，持续验证 | `code` + `tests` |
| **finish** | `/finish` | 汇总变更，执行代码审查，准备归档 | review report |

#### TDD 纪律

执行层强制执行 **Red → Green → Refactor** 节拍：

```
对每个任务：
  1. /plan      — 确认任务范围与接口契约
  2. 写测试      — 先写失败测试（Red）
  3. /execute   — 子代理实现最小可通过代码（Green）
  4. 重构        — 清理实现，保持测试通过（Refactor）
  5. /finish    — 本任务代码审查，进入下一任务
```

#### 子代理协作

`/execute` 阶段支持派发子代理并行处理独立任务：

```
主代理 (Orchestrator)
  ├── 子代理 A: 实现 UserService 接口
  ├── 子代理 B: 实现 AuthController 路由
  └── 子代理 C: 更新集成测试套件
```

子代理完成后向主代理汇报，主代理负责合并、冲突检测与一致性验证。

#### Superpowers 斜杠命令

斜杠命令定义存放于 `openspec/slash-commands.yml`，由宿主层（Claude Code / Cursor）加载执行：

```yaml
# openspec/slash-commands.yml 示例
commands:
  brainstorm:
    description: 发散探索实现路径
    input: tasks.md + knowledge/
    output: specs/<feature>.md

  plan:
    description: 细化 TDD 执行计划
    input: specs/<feature>.md
    output: plans/<task>.md

  execute:
    description: 子代理驱动编码实现
    input: plans/<task>.md
    subagents: true
    tdd: true

  finish:
    description: 代码审查与归档准备
    input: code + tests
    output: review-report.md
```

### 宿主层 (Claude Code / Cursor)

宿主层是 x-spec 的**运行时容器**，负责：

| 职责 | 说明 |
|------|------|
| **流程承载** | 加载并执行斜杠命令，驱动 brainstorm / plan / execute / finish 阶段 |
| **上下文注入** | 将 knowledge/、openspec/、plans/ 注入代理上下文，确保每步决策基于完整信息 |
| **代理协作** | 管理子代理生命周期，协调并行任务，汇总执行结果 |
| **Skill 发现** | 动态加载技能（如 frontend-design、claude-api），扩展执行能力 |

宿主层无需感知规格层细节，只需消费 `tasks.md` 和 `slash-commands.yml` 即可驱动完整执行流。

### 层间数据流

```
┌─ 规格层输入 ──────────────────────────────────────────────────┐
│  knowledge/                 (知识上下文)                       │
│  openspec/changes/<name>/   (变更文档集)                       │
│    ├── proposal.md          (变更动机与范围)                    │
│    ├── specs/               (Given-When-Then 场景)             │
│    ├── design.md            (技术方案)                         │
│    └── tasks.md             (原子任务清单)  ◄── 执行层入口      │
└──────────────────────────────┬────────────────────────────────┘
                               │ 架构师 / 开发者审查
                               ▼
┌─ 执行层流转 (Superpowers) ───────────────────────────────────┐
│                                                              │
│  [brainstorm]  tasks.md + knowledge/                         │
│       │        → specs/<name>-impl.md  (实现路径确定)         │
│       ▼                                                      │
│  [plan]        specs/<name>-impl.md                          │
│       │        → plans/<name>-plan.md  (TDD 执行计划)         │
│       ▼                                                      │
│  [execute]     plans/<name>-plan.md                          │
│       │        → code + tests          (子代理并行实现)        │
│       ▼                                                      │
│  [finish]      code + tests                                  │
│                → review-report.md     (代码审查报告)          │
└──────────────────────────────┬────────────────────────────────┘
                               │ verify（规范一致性校验）
                               ▼
┌─ 归档 ────────────────────────────────────────────────────────┐
│  openspec/archive/<name>/                                     │
│    ├── proposal.md / design.md / tasks.md                    │
│    ├── review-report.md                                      │
│    └── specs/  (合并增量后的最终规范)                          │
└───────────────────────────────────────────────────────────────┘
```

## 流程模板

流程模板以YAML格式保存在 `templates/workflows/` 目录下，简化理解和配置。

### sdd-standard.yml（标准流程）

```yaml
name: sdd-standard
description: SDD规范驱动开发标准流程
version: "1.0"
stages:
  - name: knowledge
    description: 注入项目知识上下文
    command: knowledge
    required: true
    depends_on: []
    output: knowledge/
  - name: propose
    description: 发起变更提案
    command: propose
    required: true
    depends_on: [knowledge]
    output: openspec/changes/{{change-name}}/
  - name: review
    description: 审查提案文档
    command: review
    required: true
    depends_on: [propose]
  - name: implement
    description: 执行编码实现
    command: apply
    required: true
    depends_on: [review]
  - name: verify
    description: 验证实现一致性
    command: verify
    required: true
    depends_on: [implement]
  - name: archive
    description: 归档已完成变更
    command: archive
    required: false
    depends_on: [verify]
```

### sdd-quick.yml（快速流程）
跳过知识注入和人工审查，4个阶段快速推进。

### sdd-full.yml（完整流程）
增加设计评审、单元测试验证、集成验证，7个阶段严格管控。

## 技术架构

```
x-spec/
├── src/                           ← TypeScript 源码
│   ├── index.ts                   ← CLI入口
│   ├── utils.ts                   ← 工具函数与配置类型
│   ├── types.ts                   ← 核心类型定义
│   ├── core/                      ← 核心引擎
│   │   ├── spec-engine.ts         ← OpenSpec规范引擎
│   │   ├── spec-parser.ts         ← 规范文件解析器
│   │   ├── spec-renderer.ts       ← 规范渲染器
│   │   ├── workflow-engine.ts     ← 作业流引擎（含流程模板和串接执行）
│   │   ├── template-engine.ts     ← 模板引擎
│   │   └── slash-command-engine.ts← SuperPowers执行引擎
│   └── commands/                  ← CLI命令
│       ├── init.ts                ← 初始化命令（含流程模板创建）
│       ├── knowledge.ts           ← 知识注入命令
│       ├── propose.ts             ← 变更提案命令
│       ├── apply.ts               ← 执行变更命令
│       ├── archive.ts             ← 归档命令
│       ├── verify.ts              ← 验证命令
│       ├── workflow.ts            ← 作业流命令（含compose编排）
│       ├── template.ts            ← 模板化命令
│       └── run.ts                 ← 流程串接执行命令
├── test/                          ← 测试
│   ├── cli.test.ts                ← CLI集成测试
│   └── core.test.ts               ← 核心引擎单元测试
├── x-spec/                        ← SDD规范目录（框架自身）
│   ├── openspec/
│   │   ├── specs/xspec-sdd/       ← 框架SDD自描述规范
│   │   └── slash-commands.yml     ← 斜杠命令定义
│   └── knowledge/                 ← 知识注入模板
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 项目目录结构（init后）

```
x-spec/
├── openspec/
│   ├── specs/              ← 功能规范
│   ├── changes/            ← 变更提案
│   └── archive/            ← 归档
├── workflows/              ← 作业流定义（从模板编排生成）
├── templates/
│   ├── workflows/          ← 流程模板 (YAML)
│   │   ├── sdd-standard.yml
│   │   ├── sdd-quick.yml
│   │   └── sdd-full.yml
│   └── code/               ← 代码模板
├── knowledge/              ← 知识注入
│   ├── business.md
│   ├── tech-stack.md
│   ├── api.md
│   └── sdk.md
└── x-spec.yml              ← 框架配置
```

## 快速开始

### 前置条件
- Node.js 18+

### 安装

```bash
npm install
npm run build
npm link  # 全局安装 x-spec 命令
```

### 使用

#### 方式一：一键串接执行（推荐）

```bash
# 初始化
x-spec init

# 一键执行SDD标准流程
x-spec run --description "添加用户认证功能"

# 或使用快速流程
x-spec run --template sdd-quick --description "修复登录bug"
```

#### 方式二：分步执行

```bash
# 1. 初始化
x-spec init

# 2. 注入知识上下文（自动检测方式：MCP > 本地文档 > 人工交互）
x-spec knowledge

# 3. 发起变更提案（自动引用知识上下文）
x-spec propose "添加用户认证功能"

# 4. 审查生成的提案文件

# 5. 执行变更
x-spec apply add-user-auth

# 6. 验证一致性
x-spec verify add-user-auth

# 7. 归档
x-spec archive add-user-auth
```

#### 方式三：自定义编排作业流

```bash
# 查看流程模板
x-spec workflow templates

# 从模板编排
x-spec workflow compose my-custom-flow --template sdd-standard --interactive

# 执行自定义作业流
x-spec workflow run my-custom-flow
```

## 配置文件 (x-spec.yml)

```yaml
version: "1.0.0"
profile: standard

spec-engine:
  specs-dir: openspec/specs
  changes-dir: openspec/changes
  archive-dir: openspec/archive
  scenario-format: given-when-then
  requirement-keyword: SHALL

workflow:
  workflows-dir: workflows
  workflow-templates-dir: templates/workflows
  default-timeout: 300
  step-validation: true

template:
  templates-dir: templates
  workflow-templates-dir: templates/workflows
  code-templates-dir: templates/code
  engine: handlebars

knowledge:
  knowledge-dir: knowledge
  categories:
    - business
    - tech-stack
    - api
    - sdk
  # 方式一：MCP 注入（优先级最高）
  mcp:
    enabled: false
    server: ""                      # MCP 服务器地址，如 http://mcp.internal/sse
    tools:
      - fetch_confluence_page
      - fetch_notion_doc
  # 方式二：本地文档归档（次优先）
  local-docs:
    enabled: false
    paths: []                       # 本地文档目录列表，如 ["docs/business", "docs/api"]
    glob: "**/*.md"
  # 方式三：人工交互注入（兜底，前两种均不可用时自动启用）

sdd:
  mode: spec-driven
  auto-verify: true
  strict-scenario-match: false
  proposal-required: true
  knowledge-required: true
  default-pipeline: sdd-standard
```

## 许可证

MIT License
