import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectRoot, getXSpecRoot, ensureInitialized, writeMarkdown, loadConfig } from '../utils.js';
import { McpKnowledgeEngine } from '../core/mcp-knowledge-engine.js';

interface KnowledgeAnswers {
  businessBackground: string;
  businessDomain: string;
  businessFlow: string;
  businessRules: string;
  language: string;
  framework: string;
  frameworkVersion: string;
  database: string;
  infrastructure: string;
  buildTool: string;
  apiList: string;
  apiAuth: string;
  apiSla: string;
  sdkList: string;
  middleware: string;
  utils: string;
}

export const knowledgeCommand = new Command('knowledge')
  .description('交互式注入项目知识上下文（业务背景/技术栈/API依赖/SDK依赖/MCP知识源）')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('-c, --category <category>', '仅注入特定分类 (business|tech-stack|api|sdk|mcp|mcp:<name>|all)', 'all')
  .option('--skip-completed', '跳过已有内容的分类')
  .option('--mcp-only', '仅执行 MCP 知识源注入，跳过交互式分类')
  .action(async (opts) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const xspecRoot = getXSpecRoot(root);
    const knowledgeDir = path.join(xspecRoot, 'knowledge');
    const config = loadConfig(root);

    console.log(chalk.cyan('\n╔══════════════════════════════════════════╗'));
    console.log(chalk.cyan('║  x-spec 知识注入 - SDD前置阶段          ║'));
    console.log(chalk.cyan('╚══════════════════════════════════════════╝\n'));
    console.log(chalk.gray('在发起变更提案前，注入项目知识上下文，确保SDD开发基于完整的项目理解。\n'));

    const category = opts.category;
    const skipCompleted = opts.skipCompleted;

    // ─── 交互式知识分类 ───

    if (!opts.mcpOnly) {
      // 业务背景
      if (category === 'all' || category === 'business') {
        if (shouldSkip(knowledgeDir, 'business.md', skipCompleted)) {
          console.log(chalk.gray('  ⏭ 业务背景 - 已有内容，跳过'));
        } else {
          console.log(chalk.yellow('📋 业务背景'));
          const answers = await inquirer.prompt<Partial<KnowledgeAnswers>>([
            { type: 'input', name: 'businessDomain', message: '业务领域:', default: '请描述项目所属的业务领域' },
            { type: 'editor', name: 'businessBackground', message: '业务背景描述 (将在编辑器中打开):' },
            { type: 'editor', name: 'businessFlow', message: '核心业务流程 (将在编辑器中打开):' },
            { type: 'editor', name: 'businessRules', message: '关键业务规则和约束 (将在编辑器中打开):' },
          ]);

          writeMarkdown(path.join(knowledgeDir, 'business.md'), `# 业务背景

## 业务领域
${answers.businessDomain || ''}

## 业务背景
${answers.businessBackground || ''}

## 核心业务流程
${answers.businessFlow || ''}

## 业务规则与约束
${answers.businessRules || ''}

---
*由 x-spec knowledge 交互注入 · ${new Date().toISOString()}*
`);
          console.log(chalk.green('  ✓ 业务背景已注入\n'));
        }
      }

      // 技术栈
      if (category === 'all' || category === 'tech-stack') {
        if (shouldSkip(knowledgeDir, 'tech-stack.md', skipCompleted)) {
          console.log(chalk.gray('  ⏭ 技术栈 - 已有内容，跳过'));
        } else {
          console.log(chalk.yellow('🔧 技术栈'));
          const answers = await inquirer.prompt<Partial<KnowledgeAnswers>>([
            { type: 'input', name: 'language', message: '主要编程语言:', default: 'Java' },
            { type: 'input', name: 'framework', message: '主要框架:', default: 'Spring Boot' },
            { type: 'input', name: 'frameworkVersion', message: '框架版本:', default: '3.x' },
            { type: 'input', name: 'database', message: '数据库 (类型/版本):' },
            { type: 'input', name: 'infrastructure', message: '基础设施 (部署环境/容器化):' },
            { type: 'input', name: 'buildTool', message: '构建工具:', default: 'Maven' },
          ]);

          writeMarkdown(path.join(knowledgeDir, 'tech-stack.md'), `# 技术栈

## 语言与框架
- ${answers.language || ''}
- ${answers.framework || ''} ${answers.frameworkVersion || ''}

## 数据库
${answers.database || ''}

## 基础设施
${answers.infrastructure || ''}

## 构建工具
${answers.buildTool || ''}

---
*由 x-spec knowledge 交互注入 · ${new Date().toISOString()}*
`);
          console.log(chalk.green('  ✓ 技术栈已注入\n'));
        }
      }

      // 外部API依赖
      if (category === 'all' || category === 'api') {
        if (shouldSkip(knowledgeDir, 'api.md', skipCompleted)) {
          console.log(chalk.gray('  ⏭ 外部API依赖 - 已有内容，跳过'));
        } else {
          console.log(chalk.yellow('🌐 外部API依赖'));
          const answers = await inquirer.prompt<Partial<KnowledgeAnswers>>([
            { type: 'editor', name: 'apiList', message: 'API列表 (格式: API名称 | 用途 | 端点 | 协议):' },
            { type: 'input', name: 'apiAuth', message: 'API认证方式:' },
            { type: 'input', name: 'apiSla', message: 'SLA与调用限制:' },
          ]);

          writeMarkdown(path.join(knowledgeDir, 'api.md'), `# 外部API依赖

## API列表
${answers.apiList || ''}

## 认证方式
${answers.apiAuth || ''}

## SLA与限制
${answers.apiSla || ''}

---
*由 x-spec knowledge 交互注入 · ${new Date().toISOString()}*
`);
          console.log(chalk.green('  ✓ 外部API依赖已注入\n'));
        }
      }

      // SDK依赖
      if (category === 'all' || category === 'sdk') {
        if (shouldSkip(knowledgeDir, 'sdk.md', skipCompleted)) {
          console.log(chalk.gray('  ⏭ SDK依赖 - 已有内容，跳过'));
        } else {
          console.log(chalk.yellow('📦 SDK依赖'));
          const answers = await inquirer.prompt<Partial<KnowledgeAnswers>>([
            { type: 'editor', name: 'sdkList', message: 'SDK列表 (格式: SDK名称 | 版本 | 用途):' },
            { type: 'input', name: 'middleware', message: '中间件 (Redis/MQ/注册中心等):' },
            { type: 'input', name: 'utils', message: '工具库依赖:' },
          ]);

          writeMarkdown(path.join(knowledgeDir, 'sdk.md'), `# SDK依赖

## SDK列表
${answers.sdkList || ''}

## 中间件
${answers.middleware || ''}

## 工具库
${answers.utils || ''}

---
*由 x-spec knowledge 交互注入 · ${new Date().toISOString()}*
`);
          console.log(chalk.green('  ✓ SDK依赖已注入\n'));
        }
      }
    }

    // ─── MCP 知识源注入 ───

    if (category === 'all' || category === 'mcp' || category.startsWith('mcp:')) {
      const mcpConfig = config?.['mcp-knowledge'];
      if (mcpConfig?.enabled && mcpConfig.sources.length > 0) {
        console.log(chalk.magenta('🔌 MCP 外部知识源注入'));

        const engine = new McpKnowledgeEngine(knowledgeDir, mcpConfig);

        // 列出可用知识源
        const sources = engine.listSources();
        console.log(chalk.gray(`  已配置 ${sources.length} 个 MCP 知识源:`));
        for (const s of sources) {
          const autoTag = s.autoInject ? chalk.green('自动') : chalk.gray('手动');
          console.log(chalk.gray(`    - ${s.name} (${s.type}) [${autoTag}] ${s.description}`));
        }
        console.log();

        if (category.startsWith('mcp:')) {
          // 注入指定 MCP 知识源
          const targetName = category.slice(4);
          try {
            await engine.injectByName(targetName);
          } catch (e: any) {
            console.error(chalk.red(`  ✗ MCP知识源 [${targetName}] 注入失败: ${e.message}`));
          }
        } else {
          // 注入所有 autoInject 知识源
          const results = await engine.injectAll();
          const count = Object.keys(results).length;
          if (count > 0) {
            console.log(chalk.green(`  ✓ MCP 知识源注入完成（${count} 个）\n`));
          }
        }
      } else if (category === 'mcp' || category.startsWith('mcp:')) {
        console.log(chalk.yellow('  ⚠ 未配置 MCP 知识源。请在 x-spec.yml 中添加 mcp-knowledge 配置。'));
        console.log(chalk.gray('  参见: x-spec knowledge --help 或 README.md\n'));
      }
    }

    // 生成知识摘要
    generateKnowledgeSummary(knowledgeDir);

    console.log(chalk.cyan('\n✓ 知识注入完成'));
    console.log(chalk.gray('知识上下文已就绪，可通过 x-spec propose 发起变更提案。'));
    console.log(chalk.gray('提案将自动引用已注入的知识上下文（含 MCP 外部知识源）。\n'));
  });

function shouldSkip(knowledgeDir: string, fileName: string, skipCompleted: boolean): boolean {
  if (!skipCompleted) return false;
  const filePath = path.join(knowledgeDir, fileName);
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf-8');
  const nonTemplateLines = content.split('\n').filter(
    line => line.trim() && !line.trim().startsWith('<!--') && !line.trim().startsWith('#') && !line.trim().startsWith('*') && !line.trim().startsWith('---')
  );
  return nonTemplateLines.length > 3;
}

function generateKnowledgeSummary(knowledgeDir: string) {
  const categories = ['business', 'tech-stack', 'api', 'sdk'];
  const summary: Record<string, { filled: boolean; size: number }> = {};

  for (const cat of categories) {
    const filePath = path.join(knowledgeDir, `${cat}.md`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const nonTemplateLines = content.split('\n').filter(
        line => line.trim() && !line.trim().startsWith('<!--') && !line.trim().startsWith('#') && !line.trim().startsWith('---') && !line.trim().startsWith('*由')
      );
      summary[cat] = { filled: nonTemplateLines.length > 2, size: nonTemplateLines.length };
    } else {
      summary[cat] = { filled: false, size: 0 };
    }
  }

  // 扫描 MCP 知识源文件
  const mcpFiles: string[] = [];
  if (fs.existsSync(knowledgeDir)) {
    for (const f of fs.readdirSync(knowledgeDir)) {
      if (f.endsWith('.md') && !categories.includes(f.replace('.md', '')) && f !== 'README.md' && f !== 'summary.md') {
        mcpFiles.push(f);
      }
    }
  }

  writeMarkdown(path.join(knowledgeDir, 'summary.md'), `# 知识注入摘要

| 分类 | 状态 | 信息量 |
|------|------|--------|
| 业务背景 | ${summary['business']?.filled ? '✓ 已注入' : '○ 未注入'} | ${summary['business']?.size || 0} 行 |
| 技术栈 | ${summary['tech-stack']?.filled ? '✓ 已注入' : '○ 未注入'} | ${summary['tech-stack']?.size || 0} 行 |
| 外部API | ${summary['api']?.filled ? '✓ 已注入' : '○ 未注入'} | ${summary['api']?.size || 0} 行 |
| SDK依赖 | ${summary['sdk']?.filled ? '✓ 已注入' : '○ 未注入'} | ${summary['sdk']?.size || 0} 行 |
${mcpFiles.length > 0 ? mcpFiles.map(f => `| MCP: ${f} | ✓ 已注入 | - |`).join('\n') : ''}

*生成时间: ${new Date().toISOString()}*
`);
}
