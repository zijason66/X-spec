import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectRoot, getXSpecRoot, isInitialized, writeYAML, writeMarkdown } from '../utils.js';
import type { WorkflowTemplate } from '../types.js';
import {
  scanProject,
  renderScanSummary,
} from '../core/project-scanner.js';
import {
  InitTemplateEngine,
  DEFAULT_TEMPLATE_NAME,
} from '../core/init-template-engine.js';

export const initCommand = new Command('init')
  .description('初始化项目SDD配置，创建x-spec规范目录结构')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('--profile <profile>', '工作流配置档案 (standard|extended|minimal)', 'standard')
  .option('--init-template <name>', '指定 init 渲染模板（默认 default，可用 x-spec init-template 创建自定义模板）', DEFAULT_TEMPLATE_NAME)
  .option('--force', '强制覆盖已有配置')
  .action(async (opts) => {
    const root = resolveProjectRoot(opts.path);
    const xspecRoot = getXSpecRoot(root);

    if (isInitialized(root) && !opts.force) {
      console.error(chalk.red('项目已初始化。使用 --force 强制覆盖。'));
      process.exit(1);
    }

    console.log(chalk.cyan('\n初始化SDD配置...\n'));

    // 创建目录结构
    const dirs = [
      'specs',
      'changes',
      'archive',
      'workflow',
      'templates/workflows',   // 流程模板目录
      'templates/code',        // 代码模板目录
      'templates/init',        // init 渲染模板目录
      'knowledge',
    ];

    if (opts.profile === 'extended') {
      dirs.push(
        'schemas',
        'workflows/hooks',
        'templates/snippets',
        'docs',
      );
    }

    for (const dir of dirs) {
      fs.mkdirSync(path.join(xspecRoot, dir), { recursive: true });
    }

    // 生成配置文件
    const config = buildDefaultConfig(opts.profile);
    writeYAML(path.join(xspecRoot, 'x-spec.yml'), config);

    // 生成默认规范文件
    createDefaultSpecs(path.join(xspecRoot, 'specs'));

    // 生成默认作业流
    createDefaultWorkflow(path.join(xspecRoot, 'workflows'));

    // 生成流程模板（核心新增）
    createWorkflowTemplates(path.join(xspecRoot, 'templates', 'workflows'));

    // 生成知识注入模板
    createKnowledgeTemplates(path.join(xspecRoot, 'knowledge'));

    // 确保 init 渲染模板脚手架存在（自动创建 default 模板）
    const templateEngine = new InitTemplateEngine(root);
    templateEngine.ensureDefaultTemplate();

    // 校验用户指定的模板
    const templateName: string = opts.initTemplate || DEFAULT_TEMPLATE_NAME;
    if (!templateEngine.exists(templateName)) {
      console.warn(chalk.yellow(`⚠ 指定的 init 渲染模板 "${templateName}" 不存在，回退到 default`));
    }
    const effectiveTemplate = templateEngine.exists(templateName) ? templateName : DEFAULT_TEMPLATE_NAME;

    // 扫描代码仓，按指定模板渲染 knowledge 索引
    console.log(chalk.cyan('\n扫描代码仓建立项目知识底座...\n'));
    let scanSummary = '';
    try {
      const scan = scanProject(root);
      const result = templateEngine.renderAndWrite(
        effectiveTemplate,
        scan,
        path.join(xspecRoot, 'knowledge'),
      );
      scanSummary = renderScanSummary(scan);
      console.log(chalk.green('✓ 项目知识底座已建立\n'));
      console.log(scanSummary);
      console.log();
      console.log(chalk.cyan(`init 渲染模板: ${effectiveTemplate}`));
      if (result.written.length > 0) {
        console.log(chalk.gray(`  已输出: ${result.written.join(', ')}`));
      }
      if (result.omitted.length > 0) {
        console.log(chalk.gray(`  已省略: ${result.omitted.join(', ')}`));
      }
      for (const fb of result.fallbacks) {
        console.warn(chalk.yellow(`  ⚠ ${fb.key}: ${fb.reason}`));
      }
      console.log();
    } catch (e: any) {
      console.warn(chalk.yellow(`⚠ 项目扫描失败，knowledge 目录保留默认模板: ${e.message}`));
    }


    console.log(chalk.green('✓ 初始化完成\n'));
    console.log(chalk.cyan('已创建目录结构:'));
    console.log('  x-spec/');
    console.log('  ├── specs/                 ← 功能规范');
    console.log('  ├── changes/               ← 变更提案');
    console.log('  ├── archive/               ← 归档');
    console.log('  ├── workflow/              ← 工作流定义');
    console.log('  ├── templates/');
    console.log('  │   ├── workflows/          ← 流程模板 (YAML)');
    console.log('  │   ├── code/               ← 代码模板');
    console.log('  │   └── init/               ← init 渲染模板（可自定义）');
    console.log('  ├── knowledge/              ← 知识底座（已按模板渲染填充）');
    console.log('  │   ├── architecture.md     ← 代码架构索引');
    console.log('  │   ├── tech-stack.md       ← 技术栈');
    console.log('  │   ├── api.md              ← 外部 API 调用');
    console.log('  │   ├── business.md         ← 业务背景线索');
    console.log('  │   ├── schema.md           ← 数据表结构');
    console.log('  │   ├── class-index.md      ← 关键类索引');
    console.log('  │   └── sdk.md              ← SDK 依赖');
    console.log('  └── x-spec.yml              ← 框架配置（含MCP知识源配置）');
    console.log();
    console.log(chalk.yellow('流程模板（开发具体需求时按需选择，非Init阶段决策）:'));
    console.log('  ' + chalk.gray('templates/workflows/sdd-standard.yml    ← SDD标准流程（6阶段）'));
    console.log('  ' + chalk.gray('templates/workflows/sdd-quick.yml       ← SDD快速流程（4阶段，紧急修复）'));
    console.log('  ' + chalk.gray('templates/workflows/sdd-full.yml        ← SDD完整流程（7阶段，高风险变更）'));
    console.log('  ' + chalk.yellow('templates/workflows/superpower.yml      ← SuperPower 快速交付（100-500行）'));
    console.log();
    console.log(chalk.yellow('说明:'));
    console.log('  ' + chalk.gray('Init 阶段只建立项目知识底座，不做开发模式选择。'));
    console.log('  ' + chalk.gray('开发具体需求时，根据工作量与熟练度自行选择流程：'));
    console.log('  ' + chalk.blue('💬 < 100行')  + '   对话式 — 直接与AI对话，可选补充spec沉淀');
    console.log('  ' + chalk.yellow('⚡ 100-500行') + '  SuperPower — 快速交付，自动生成spec文档');
    console.log('  ' + chalk.green('📋 > 500行')  + '   SDD标准/完整流程 — 知识注入→提案→审核→编码→验证');
    console.log();
    console.log(chalk.yellow('自定义 init 渲染模板:'));
    console.log('  ' + chalk.cyan('x-spec init-template list') + '       ← 列出可用模板');
    console.log('  ' + chalk.cyan('x-spec init-template create <name>') + ' ← 创建自定义模板');
    console.log('  ' + chalk.cyan('x-spec init --init-template <name>') + ' ← 按指定模板初始化');
    console.log();
    console.log(chalk.yellow('下一步（开发具体需求时）:'));
    console.log('  ' + chalk.cyan('x-spec mode "需求描述"') + '      ← 智能评估并推荐开发模式');
    console.log('  ' + chalk.cyan('x-spec sp "需求描述"') + '         ← SuperPower 快速开发启动');
    console.log('  ' + chalk.cyan('x-spec propose "需求描述"') + '   ← SDD 完整流程');
    console.log('  ' + chalk.gray('（所有流程均基于本次 Init 沉淀的项目知识底座启动）'));
    console.log();
  });

function buildDefaultConfig(profile: string) {
  return {
    version: '1.0.0',
    profile,
    'spec-engine': {
      'specs-dir': 'specs',
      'changes-dir': 'changes',
      'archive-dir': 'archive',
      'scenario-format': 'given-when-then',
      'requirement-keyword': 'SHALL',
    },
    workflow: {
      'workflows-dir': 'workflows',
      'workflow-templates-dir': 'templates/workflows',
      'default-timeout': 300,
      'step-validation': true,
    },
    template: {
      'templates-dir': 'templates',
      'workflow-templates-dir': 'templates/workflows',
      'code-templates-dir': 'templates/code',
      engine: 'handlebars',
    },
    knowledge: {
      'knowledge-dir': 'knowledge',
      categories: ['business', 'tech-stack', 'api', 'sdk'],
    },
    'mcp-knowledge': {
      enabled: true,
      sources: [
        {
          name: 'code-graph',
          type: 'code-graph',
          description: '代码图谱 - 提供代码仓库的依赖关系、调用链、模块结构等结构化知识',
          server: {
            command: 'node',
            args: ['path/to/your/code-graph-mcp/server.js'],
          },
          tool: 'query_code_graph',
          toolParams: { query: '{{project-root}}', depth: '2' },
          outputFile: 'mcp-code-graph.md',
          autoInject: true,
          prompt: '提取与当前变更相关的模块依赖关系和核心调用链，忽略无关模块',
        },
        {
          name: 'product-knowledge',
          type: 'knowledge-base',
          description: '产品知识库 - 提供历史需求、产品文档、业务规则等结构化知识',
          server: {
            command: 'node',
            args: ['path/to/your/knowledge-mcp/server.js'],
          },
          tool: 'search_knowledge',
          toolParams: { query: '{{project-root}}', limit: '10' },
          outputFile: 'mcp-product-knowledge.md',
          autoInject: true,
          prompt: '提取与当前变更相关的产品需求和业务规则，聚焦核心逻辑',
        },
      ],
    },
    mode: {
      'conversational-max': 100,
      'superpower-max': 500,
    },
    review: {
      'auto-review-on-propose': true,
      'min-rounds': 1,
      'max-rounds': 3,
      'auto-approve-score': 80,
      'require-human-approval': true,
      'review-dimensions': [
        '需求完整性：proposal.md 是否清晰描述了动机、影响范围和成功标准',
        '技术可行性：design.md 中的方案是否在已有技术栈约束下可实现',
        '任务拆解合理性：tasks.md 中的任务是否粒度适中、依赖清晰',
        '规范一致性：specs/ 增量是否符合 Given-When-Then 格式且覆盖关键场景',
        '知识引用完整性：knowledge-ref.md 是否正确引用了相关业务知识和代码结构',
      ],
    },
    sdd: {
      mode: 'spec-driven',
      'auto-verify': true,
      'strict-scenario-match': false,
      'proposal-required': true,
      'knowledge-required': true,
      'default-pipeline': 'sdd-standard',
    },
  };
}

function createDefaultSpecs(specsDir: string) {
  const specs: Record<string, string> = {
    'xspec-init/spec.md': `# x-spec Init Specification

## Purpose
定义 x-spec 初始化配置的标准行为，确保SDD规范在项目中的正确应用。

### Requirement: Directory structure creation
The system SHALL create the x-spec directory structure with specs, changes, archive, workflow, templates/workflows, templates/code, and knowledge subdirectories.

#### Scenario: Standard initialization
- GIVEN a project without x-spec configuration
- WHEN \`x-spec init\` is executed
- THEN the x-spec directory structure SHALL be created
- AND a x-spec.yml configuration file SHALL be generated
- AND workflow template YAML files SHALL be created in templates/workflows/

### Requirement: Knowledge injection
The system SHALL support interactive knowledge injection before spec-driven development begins.

#### Scenario: Knowledge injection before proposal
- GIVEN a project initialized with x-spec
- WHEN \`x-spec knowledge\` is executed
- THEN business context, tech stack, API and SDK dependencies SHALL be collected
- AND the knowledge context SHALL be available for subsequent proposals
`,
    'xspec-workflow/spec.md': `# x-spec Workflow Specification

## Purpose
定义作业流标准化创建、验证和执行的行为规范。

### Requirement: Workflow definition
The system SHALL support YAML-based workflow definitions with sequential and parallel steps.

#### Scenario: Sequential workflow execution
- GIVEN a workflow with ordered steps
- WHEN the workflow is executed
- THEN each step SHALL execute in order
- AND a step SHALL only start after the previous step completes successfully

### Requirement: Pipeline execution
The system SHALL support pipeline execution that chains workflow stages automatically.

#### Scenario: Default SDD pipeline
- GIVEN a project initialized with x-spec
- WHEN \`x-spec run\` is executed
- THEN the default SDD standard pipeline SHALL execute all stages in sequence
- AND each stage SHALL check its dependencies before execution
- AND the pipeline SHALL stop if a required stage fails
`,
    'xspec-template/spec.md': `# x-spec Template Specification

## Purpose
定义代码仓库模板化处理的行为规范。

### Requirement: Template extraction
The system SHALL extract reusable templates from existing code with variable placeholders.

#### Scenario: Extract template from source code
- GIVEN an existing source file
- WHEN \`x-spec template extract\` is executed with variable definitions
- THEN a template file SHALL be created with variables replaced by placeholders
`,
    'xspec-knowledge/spec.md': `# x-spec Knowledge Specification

## Purpose
定义知识注入阶段的行为规范，确保SDD开发前项目上下文完整。

### Requirement: Knowledge collection
The system SHALL collect business context, tech stack, API dependencies, and SDK dependencies through interactive prompts.

#### Scenario: Full knowledge injection
- GIVEN a project initialized with x-spec
- WHEN \`x-spec knowledge\` is executed
- THEN the system SHALL prompt for business background
- AND prompt for tech stack information
- AND prompt for external API dependencies
- AND prompt for SDK dependencies
- AND all collected knowledge SHALL be persisted to the knowledge directory

### Requirement: MCP external knowledge source injection
The system SHALL support injecting knowledge from MCP-compatible external knowledge sources.

#### Scenario: Auto-inject MCP knowledge sources
- GIVEN a project with mcp-knowledge configuration in x-spec.yml
- WHEN \`x-spec knowledge\` is executed
- THEN the system SHALL connect to each autoInject MCP server
- AND call the configured tool on each server
- AND persist the results to the knowledge directory
- AND the results SHALL be included in subsequent change proposals

#### Scenario: Inject specific MCP knowledge source
- GIVEN a project with mcp-knowledge configuration
- WHEN \`x-spec knowledge -c mcp:code-graph\` is executed
- THEN the system SHALL only inject the named MCP knowledge source
- AND other MCP sources SHALL be skipped

#### Scenario: MCP knowledge source failure
- GIVEN a project with mcp-knowledge configuration
- WHEN an MCP server connection or tool call fails
- THEN the system SHALL log a warning
- AND other knowledge sources SHALL continue to be injected
- AND the failure SHALL NOT block the overall knowledge injection process

### Requirement: Knowledge context in proposals
The system SHALL include knowledge context when generating change proposals.

#### Scenario: Proposal with knowledge
- GIVEN a project with injected knowledge
- WHEN \`x-spec propose\` is executed
- THEN the generated proposal SHALL reference relevant knowledge context
- AND the design document SHALL consider tech stack constraints
- AND MCP external knowledge SHALL be included in knowledge-ref.md
`,
  };

  for (const [filePath, content] of Object.entries(specs)) {
    writeMarkdown(path.join(specsDir, filePath), content);
  }
}

function createDefaultWorkflow(workflowsDir: string) {
  const workflow = {
    name: 'sdd-standard-flow',
    description: 'SDD规范驱动开发标准作业流（含知识注入阶段）',
    steps: [
      { name: 'knowledge', description: '注入项目知识上下文', action: 'xspec.knowledge', required: true, depends_on: [] },
      { name: 'propose', description: '发起变更提案', action: 'spec.propose', required: true, depends_on: ['knowledge'] },
      { name: 'review', description: '审查提案文档', action: 'manual.review', required: true, depends_on: ['propose'] },
      { name: 'implement', description: '执行编码实现', action: 'spec.apply', required: true, depends_on: ['review'] },
      { name: 'verify', description: '验证实现一致性', action: 'spec.verify', required: true, depends_on: ['implement'] },
      { name: 'archive', description: '归档已完成变更', action: 'spec.archive', required: false, depends_on: ['verify'] },
    ],
  };
  writeYAML(path.join(workflowsDir, 'sdd-standard-flow.yml'), workflow);
}

/**
 * 创建流程模板 - 以YAML格式保存，简化理解和配置
 */
function createWorkflowTemplates(templatesDir: string) {
  // SDD标准流程模板
  const sddStandard: WorkflowTemplate = {
    name: 'sdd-standard',
    description: 'SDD规范驱动开发标准流程',
    version: '1.0',
    stages: [
      {
        name: 'knowledge',
        description: '注入项目知识上下文',
        command: 'knowledge',
        required: true,
        depends_on: [],
        output: 'knowledge/',
      },
      {
        name: 'propose',
        description: '发起变更提案',
        command: 'propose',
        required: true,
        depends_on: ['knowledge'],
        params: { description: '{{change-description}}' },
        output: 'changes/{{change-name}}/',
      },
      {
        name: 'review',
        description: '审查提案文档',
        command: 'review',
        required: true,
        depends_on: ['propose'],
        params: { action: 'manual' },
      },
      {
        name: 'implement',
        description: '执行编码实现',
        command: 'apply',
        required: true,
        depends_on: ['review'],
      },
      {
        name: 'verify',
        description: '验证实现一致性',
        command: 'verify',
        required: true,
        depends_on: ['implement'],
      },
      {
        name: 'archive',
        description: '归档已完成变更',
        command: 'archive',
        required: false,
        depends_on: ['verify'],
      },
    ],
  };

  // SDD快速流程模板 - 跳过知识注入和人工审查
  const sddQuick: WorkflowTemplate = {
    name: 'sdd-quick',
    description: 'SDD快速开发流程（跳过知识注入和人工审查）',
    version: '1.0',
    stages: [
      {
        name: 'propose',
        description: '发起变更提案',
        command: 'propose',
        required: true,
        depends_on: [],
        params: { description: '{{change-description}}', 'skip-knowledge-check': 'true' },
        output: 'changes/{{change-name}}/',
      },
      {
        name: 'implement',
        description: '执行编码实现',
        command: 'apply',
        required: true,
        depends_on: ['propose'],
      },
      {
        name: 'verify',
        description: '验证实现一致性',
        command: 'verify',
        required: true,
        depends_on: ['implement'],
      },
      {
        name: 'archive',
        description: '归档已完成变更',
        command: 'archive',
        required: false,
        depends_on: ['verify'],
      },
    ],
  };

  // SDD完整流程模板 - 包含更多检查点
  const sddFull: WorkflowTemplate = {
    name: 'sdd-full',
    description: 'SDD完整流程（含知识注入、设计评审、编码实现、单元测试、集成验证、归档）',
    version: '1.0',
    stages: [
      {
        name: 'knowledge',
        description: '注入项目知识上下文',
        command: 'knowledge',
        required: true,
        depends_on: [],
        output: 'knowledge/',
      },
      {
        name: 'propose',
        description: '发起变更提案',
        command: 'propose',
        required: true,
        depends_on: ['knowledge'],
        params: { description: '{{change-description}}' },
        output: 'changes/{{change-name}}/',
      },
      {
        name: 'design-review',
        description: '设计评审（审查技术方案）',
        command: 'review',
        required: true,
        depends_on: ['propose'],
        params: { action: 'manual', focus: 'design' },
      },
      {
        name: 'implement',
        description: '执行编码实现',
        command: 'apply',
        required: true,
        depends_on: ['design-review'],
      },
      {
        name: 'unit-test',
        description: '单元测试验证',
        command: 'verify',
        required: true,
        depends_on: ['implement'],
        params: { strict: 'true' },
      },
      {
        name: 'integration-verify',
        description: '集成验证',
        command: 'verify',
        required: true,
        depends_on: ['unit-test'],
      },
      {
        name: 'archive',
        description: '归档已完成变更',
        command: 'archive',
        required: false,
        depends_on: ['integration-verify'],
      },
    ],
  };

  // SuperPower 快速交付流程模板（100-500行需求，跳过审核）
  const superpowerFlow: WorkflowTemplate = {
    name: 'superpower',
    description: 'SuperPower 快速交付流程（100-500行，跳过审核直接编码，完成后自动沉淀spec）',
    version: '1.0',
    stages: [
      {
        name: 'sp-propose',
        description: 'SuperPower 提案（简化版，无需 design/tasks）',
        command: 'sp',
        required: true,
        depends_on: [],
        params: { description: '{{change-description}}' },
        output: 'changes/{{change-name}}/',
      },
      {
        name: 'implement',
        description: '直接编码实现（无审核环节）',
        command: 'apply',
        required: true,
        depends_on: ['sp-propose'],
        params: { 'skip-review-check': 'true' },
      },
      {
        name: 'sp-done',
        description: '完成沉淀 spec 文档',
        command: 'sp done',
        required: true,
        depends_on: ['implement'],
        output: 'specs/{{change-name}}/spec.md',
      },
      {
        name: 'verify',
        description: '验证规范一致性',
        command: 'verify',
        required: false,
        depends_on: ['sp-done'],
      },
      {
        name: 'archive',
        description: '归档变更',
        command: 'archive',
        required: false,
        depends_on: ['verify'],
      },
    ],
  };

  writeYAML(path.join(templatesDir, 'sdd-standard.yml'), sddStandard);
  writeYAML(path.join(templatesDir, 'sdd-quick.yml'), sddQuick);
  writeYAML(path.join(templatesDir, 'sdd-full.yml'), sddFull);
  writeYAML(path.join(templatesDir, 'superpower.yml'), superpowerFlow);
}

function createKnowledgeTemplates(knowledgeDir: string) {
  writeMarkdown(path.join(knowledgeDir, 'README.md'), `# 项目知识库

本目录存放通过 \`x-spec knowledge\` 命令交互注入的项目知识上下文。

## 知识分类

| 目录 | 内容 |
|------|------|
| \`business.md\` | 业务背景、领域模型、业务流程 |
| \`tech-stack.md\` | 技术栈、框架版本、基础设施 |
| \`api.md\` | 外部API依赖、接口规范 |
| \`sdk.md\` | SDK依赖、工具库、中间件 |

## 使用方式

\`\`\`bash
# 交互式注入所有知识分类
x-spec knowledge

# 仅注入特定分类
x-spec knowledge --category business
x-spec knowledge --category tech-stack
x-spec knowledge --category api
x-spec knowledge --category sdk
\`\`\`
`);

  writeMarkdown(path.join(knowledgeDir, 'business.md'), `# 业务背景

<!-- 通过 x-spec knowledge 命令交互填充，或手动编辑 -->

## 业务领域
<!-- 描述项目所属的业务领域 -->

## 核心业务流程
<!-- 描述核心业务流程 -->

## 领域模型
<!-- 描述关键领域模型及关系 -->

## 业务规则
<!-- 描述关键业务规则和约束 -->
`);

  writeMarkdown(path.join(knowledgeDir, 'tech-stack.md'), `# 技术栈

<!-- 通过 x-spec knowledge 命令交互填充，或手动编辑 -->

## 语言与框架
<!-- 主要编程语言、框架版本 -->

## 数据库
<!-- 数据库类型、版本 -->

## 基础设施
<!-- 部署环境、容器化方案 -->

## 构建工具
<!-- 构建工具版本及关键插件 -->
`);

  writeMarkdown(path.join(knowledgeDir, 'api.md'), `# 外部API依赖

<!-- 通过 x-spec knowledge 命令交互填充，或手动编辑 -->

## API列表
<!-- 格式: API名称 | 用途 | 端点 | 协议 -->

## 认证方式
<!-- API认证机制 -->

## SLA与限制
<!-- API的SLA和调用限制 -->
`);

  writeMarkdown(path.join(knowledgeDir, 'sdk.md'), `# SDK依赖

<!-- 通过 x-spec knowledge 命令交互填充，或手动编辑 -->

## SDK列表
<!-- 格式: SDK名称 | 版本 | 用途 -->

## 中间件
<!-- Redis、MQ、注册中心等 -->

## 工具库
<!-- 通用工具库依赖 -->
`);
}
