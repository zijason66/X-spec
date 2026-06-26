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

### 1. 代码仓索引与初始化 (Init)

对整个代码仓进行**一次性扫描与索引**，抽取项目级知识上下文作为后续所有SDD开发的共享基线，同时生成规范目录与流程模板脚手架。

> ⚠️ **Init 阶段不做开发模式选择**。Init 只负责建立"项目知识底座"；具体走标准SDD、快速SDD还是完整SDD，由**每次具体需求开发时**开发者按工作量与熟练度自行选择（详见 [开发模式选择](#开发模式选择按需非init阶段)）。

```bash
x-spec init --path /path/to/project
x-spec init --path /path/to/project --init-template my-template   # 按自定义模板渲染
```

#### Init 渲染模板机制

`x-spec init` 输出的 7 个 knowledge 索引文件由 **init 渲染模板** 控制，模板存放在 `x-spec/templates/init/<name>/`，每个模板含：

- `template.yml` — 元数据 + `outputs` 策略映射
- 可选的静态 `.md` 文件（用 `file:` 策略时引用）
- `README.md` — 模板说明

每个索引的渲染策略有三种：

| 策略 | 含义 |
|------|------|
| `default` | 使用内置扫描渲染器（基于 project-scanner.ts 自动填充） |
| `file:./xxx.md` | 使用模板目录下的静态 markdown 文件（不做替换，适合公司模板/固定文档） |
| `omit` | 不输出该索引文件（精简输出场景） |

`template.yml` 示例：
```yaml
name: my-template
description: 公司内部精简模板（仅保留架构与关键类）
version: "1.0"
outputs:
  architecture: default                  # 用扫描结果
  class-index: default                   # 用扫描结果
  tech-stack: file:./tech-stack.md       # 用公司技术栈规范文档覆盖
  api: omit                              # 不输出
  business: omit
  schema: omit
  sdk: omit
```

#### 模板管理命令

```bash
# init 时自动创建 default 模板脚手架
x-spec init

# 列出所有可用模板
x-spec init-template list

# 从 default 派生新模板
x-spec init-template create my-template --description "公司内部精简模板"

# 查看模板配置详情
x-spec init-template show my-template

# 按指定模板初始化（找不到时自动回退 default 并告警）
x-spec init --init-template my-template
```



#### Init 阶段自动抽取的项目索引

| 索引类别 | 抽取内容 | 沉淀位置 |
|---------|---------|---------|
| **代码架构** | 模块/包结构、分层组织、入口类、依赖关系图 | `x-spec/knowledge/architecture.md` |
| **技术栈** | 语言/框架版本、构建工具、运行时、基础设施 | `x-spec/knowledge/tech-stack.md` |
| **外部API** | 第三方API端点、调用方式、认证机制、SLA | `x-spec/knowledge/api.md` |
| **业务知识** | 业务领域、核心流程、领域模型、业务规则 | `x-spec/knowledge/business.md` |
| **数据表结构** | 关键数据表、字段含义、索引、表间关系 | `x-spec/knowledge/schema.md` |
| **关键类索引** | 核心类位置（文件路径+行号）、关键服务/接口清单 | `x-spec/knowledge/class-index.md` |
| **SDK依赖** | 中间件、工具库、SDK版本与用途 | `x-spec/knowledge/sdk.md` |

#### Init 阶段顺带生成的脚手架

- `x-spec/specs/` — 功能规范目录
- `x-spec/changes/` — 变更提案目录（空，等待 propose 填充）
- `x-spec/archive/` — 归档目录
- `x-spec/workflows/` — 作业流定义目录
- `x-spec/templates/workflows/` — 流程模板（YAML，4套）
  - `sdd-standard.yml` — SDD标准流程（6阶段）
  - `sdd-quick.yml` — SDD快速流程（4阶段，跳过知识注入和审查）
  - `sdd-full.yml` — SDD完整流程（7阶段，含设计评审和集成验证）
  - `superpower.yml` — SuperPower 快速交付（100-500行需求）
- `x-spec/templates/code/` — 代码模板目录
- `x-spec/x-spec.yml` — 框架配置（含 MCP 知识源、review、sdd 等配置）

#### Init 阶段不做的事情

- ❌ 不选择开发模式（标准SDD / 快速SDD / 完整SDD）
- ❌ 不发起任何变更提案
- ❌ 不修改业务源码、构建配置或 `pom.xml`/`package.json`

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

## 开发模式选择（按需，非Init阶段）

Init 阶段只建立项目知识底座，**不锁定**任何开发模式。开发模式的选择发生在**每次具体需求开发时**，由开发者根据需求工作量大小与团队熟练程度自行决策。同一仓库的不同需求可以走不同流程——它们共享同一份 Init 沉淀的项目知识底座，但流程深度按需调整。

### 决策矩阵

| 需求特征 | 推荐流程 | 命令 | 适用场景 |
|---------|---------|------|---------|
| 工作量极小（< 100行）或团队高度熟练 | 对话式 | 直接与AI对话，可选补充spec沉淀 | 改一行配置、修一个文案 |
| 中等需求（100-500行），需快速交付但保留spec沉淀 | SuperPower | `x-spec run --template superpower --description "..."` | 新增一个简单接口、补充一个CRUD模块 |
| 复杂需求（> 500行），跨模块变更，需完整评审 | SDD 标准流程 | `x-spec run --template sdd-standard --description "..."` | 新增认证体系、重构核心模块 |
| 高风险/合规要求高的关键变更 | SDD 完整流程 | `x-spec run --template sdd-full --description "..."` | 涉及资金、安全、对外协议变更 |
| 紧急修复，跳过知识注入与审查 | SDD 快速流程 | `x-spec run --template sdd-quick --description "..."` | 线上bug紧急hotfix |

### 智能推荐

不确定该走哪个流程时，可让 x-spec 基于需求描述智能评估并推荐：

```bash
x-spec mode "需求描述"      # 智能评估并推荐开发模式
x-spec sp "需求描述"        # 直接走 SuperPower 快速开发
x-spec propose "需求描述"   # 直接走 SDD 完整流程
```

> 💡 **关键边界**：模式选择是**需求级别**的决策，不是**仓库级别**的决策。Init 阶段无论仓库多大、需求多复杂，都只做一次索引；后续每个需求独立选模式，互不影响。

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

## 示例：DemoService 初始化前后目录结构对比

以一个典型的 Java/Maven 后端服务 `DemoService` 为例，展示执行 `x-spec init` 前后的目录结构变化。X-spec 遵循**棕地优先**理念，原有项目结构完全保留，所有SDD规范产物隔离在新增的 `x-spec/` 子目录内。

### 初始化前（传统 Java/Maven 项目）

```
DemoService/
├── .idea/                       ← IDE 配置（IntelliJ IDEA）
├── .mvn/                        ← Maven Wrapper 支持
├── build/                       ← 构建产物输出目录
│   └── classes/
├── src/                         ← Java 源码
│   ├── main/
│   │   ├── java/
│   │   │   └── com/demoservice/
│   │   │       ├── controller/
│   │   │       ├── service/
│   │   │       ├── repository/
│   │   │       └── DemoServiceApplication.java
│   │   └── resources/
│   │       └── application.yml
│   └── test/
│       └── java/
├── target/                      ← Maven 编译产物
├── .gitignore
├── mvnw                         ← Maven Wrapper 脚本（Unix）
├── mvnw.cmd                     ← Maven Wrapper 脚本（Windows）
├── pom.xml                      ← Maven 项目对象模型
└── README.md
```

### 初始化后（执行 `x-spec init` 后）

```
DemoService/
├── .idea/                       ← 原有保留
├── .mvn/                        ← 原有保留
├── build/                       ← 原有保留
├── src/                         ← 原 Java 源码不动
├── target/                      ← 原有保留
├── x-spec/                      ← ✨ X-spec 新增的 SDD 规范目录
│   ├── specs/                   ← 功能规范
│   │   ├── xspec-init/spec.md
│   │   ├── xspec-workflow/spec.md
│   │   ├── xspec-template/spec.md
│   │   └── xspec-knowledge/spec.md
│   ├── changes/                 ← 变更提案（空，等待 propose 填充）
│   ├── archive/                 ← 归档目录（空，等待 archive 填充）
│   ├── workflows/               ← 作业流定义
│   │   └── sdd-standard-flow.yml
│   ├── templates/
│   │   ├── workflows/           ← 流程模板（YAML）
│   │   │   ├── sdd-standard.yml
│   │   │   ├── sdd-quick.yml
│   │   │   ├── sdd-full.yml
│   │   │   └── superpower.yml
│   │   └── code/                ← 代码模板（空，等待 template extract 填充）
│   ├── knowledge/               ← 知识注入模板
│   │   ├── README.md
│   │   ├── business.md
│   │   ├── tech-stack.md
│   │   ├── api.md
│   │   └── sdk.md
│   └── x-spec.yml               ← 框架配置（含 MCP 知识源、review、sdd 等配置）
├── .gitignore                   ← 原有保留
├── mvnw                         ← 原有保留
├── mvnw.cmd                     ← 原有保留
├── pom.xml                      ← 原 Maven 配置不动
└── README.md                    ← 原有保留
```

### 关键变化说明

| 维度 | 说明 |
|------|------|
| **零侵入** | 原有 `pom.xml`、`src/`、`build/`、`target/` 等结构完全保留，构建流程不受影响 |
| **隔离收纳** | 所有SDD产物（规范、变更、作业流、知识、模板）统一收纳在 `x-spec/` 子目录下 |
| **Git 友好** | `x-spec/` 整体可纳入版本控制，规范随代码一同演进，作为活文档持久存在 |
| **立即可用** | 初始化即生成 4 套流程模板、1 套默认作业流、4 份知识模板与 4 份自描述规范，可直接进入 `x-spec knowledge` → `x-spec propose` 流程 |

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
