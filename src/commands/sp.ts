/**
 * x-spec sp — SuperPower 快速开发命令
 *
 * 适用场景：估算代码量 100-500 行的中等需求，追求快速交付同时沉淀 spec 文档。
 *
 * 流程：
 *   1. 评估需求复杂度（可跳过）
 *   2. 创建简化提案（无需 design.md / tasks.md）
 *   3. 直接进入编码（无审核流程）
 *   4. 编码完成后自动生成 spec 沉淀文档
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import { SpecEngine } from '../core/spec-engine.js';
import { ModeRouter, MODE_DISPLAY } from '../core/mode-router.js';
import { resolveProjectRoot, getXSpecRoot, ensureInitialized, writeMarkdown } from '../utils.js';
import type { SuperPowerSession } from '../types.js';

// ─── sp 主命令：SuperPower 快速开发启动 ───

export const spCommand = new Command('sp')
  .alias('superpower')
  .description('SuperPower 快速开发模式 — 快速交付并自动沉淀 spec 文档（适用于 100-500 行需求）')
  .argument('<description>', '需求描述')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('-n, --name <name>', '变更名称（自动生成则留空）')
  .option('--lines <n>', '手动指定估算代码行数（覆盖自动估算）')
  .option('--force-sdd', '强制使用完整 SDD 流程（即使行数较少）')
  .action(async (description: string, opts) => {
    const root = resolveProjectRoot(opts.path);
    const config = ensureInitialized(root);
    const xspecRoot = getXSpecRoot(root);
    const router = new ModeRouter(buildThresholds(config));

    // ── 模式评估 ──
    const estimatedLines = opts.lines ? parseInt(opts.lines) : undefined;
    const estimate = estimatedLines
      ? { ...router.estimate(description), estimatedLines, userOverride: true }
      : router.estimate(description);

    if (opts.forceSdd) {
      estimate.recommendedMode = 'SDD';
      estimate.rationale = `用户强制使用 SDD 完整流程（估算 ~${estimate.estimatedLines} 行）`;
      estimate.userOverride = true;
    }

    router.printRecommendation(estimate);

    // ── 模式路由 ──
    if (estimate.recommendedMode === 'CONVERSATIONAL') {
      console.log(chalk.blue('💬 需求较小，推荐直接对话式实现'));
      console.log(chalk.gray('   直接向 AI 描述需求即可，无需使用结构化流程。'));
      console.log(chalk.gray('   如需沉淀 spec，完成后运行: x-spec sp:spec <描述> --name <名称>'));
      return;
    }

    if (estimate.recommendedMode === 'SDD') {
      console.log(chalk.green('📋 需求规模较大，建议使用完整 SDD 流程'));
      console.log(chalk.gray('   x-spec propose "' + description + '"'));
      console.log(chalk.gray('   使用 --force 强制以 SuperPower 模式执行'));
      if (!opts.lines) return; // 若未手动指定行数，直接退出引导
    }

    // ── SuperPower 流程 ──
    const changeName = opts.name || generateChangeName(description);

    console.log(chalk.yellow(`⚡ SuperPower 快速开发: ${changeName}`));
    console.log(chalk.gray(`   估算代码量: ~${estimate.estimatedLines} 行`));
    console.log();

    // 1. 创建简化提案包（跳过 design.md / tasks.md 审核）
    const spinner = ora('创建 SuperPower 提案...').start();
    try {
      createSuperpowerProposal(xspecRoot, changeName, description, estimate.estimatedLines);
      spinner.succeed('提案文件已创建');
    } catch (e: any) {
      spinner.fail(e.message);
      process.exit(1);
    }

    // 2. 保存 SuperPower 会话
    const session: SuperPowerSession = {
      changeName,
      description,
      estimatedLines: estimate.estimatedLines,
      createdAt: new Date().toISOString(),
      status: 'IMPLEMENTING',
    };
    router.saveSession(session, xspecRoot);

    // 3. 输出操作指引
    const changeDir = path.relative(root, path.join(xspecRoot, 'changes', changeName));
    console.log();
    console.log(chalk.cyan(`路径: ${changeDir}/`));
    console.log('  ├── proposal.md       ← 需求描述');
    console.log('  └── specs/            ← 规范增量（完成后自动生成）');
    console.log();
    console.log(chalk.yellow('─── SuperPower 开发流程 ───'));
    console.log();
    console.log(`  ${chalk.bold('步骤1')} 直接开始编码实现`);
    console.log(chalk.gray('         AI 助手会根据 proposal.md 中的需求描述直接生成代码'));
    console.log();
    console.log(`  ${chalk.bold('步骤2')} 完成编码后，沉淀 spec 文档`);
    console.log(chalk.cyan(`         x-spec sp done ${changeName}`));
    console.log(chalk.gray('         → 自动生成 spec.md，记录本轮功能规范'));
    console.log();
    console.log(`  ${chalk.bold('步骤3')} （可选）使用 x-spec verify 验证规范一致性`);
    console.log(chalk.cyan(`         x-spec verify ${changeName}`));
    console.log();
    console.log(chalk.gray('提示: 如需完整 SDD 流程，使用 x-spec propose 替代'));
  });

// ─── 子命令：sp done — 完成编码后沉淀 spec ───

spCommand
  .command('done [changeName]')
  .description('SuperPower 开发完成，自动生成 spec 沉淀文档')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('-m, --message <msg>', '本轮交付备注')
  .action(async (changeName: string | undefined, opts) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const xspecRoot = getXSpecRoot(root);
    const router = new ModeRouter();

    // 解析变更名称
    const resolvedName = changeName || findActiveSuperpowerSession(xspecRoot);
    if (!resolvedName) {
      console.error(chalk.red('未找到进行中的 SuperPower 会话，请指定变更名称'));
      process.exit(1);
    }

    const session = router.loadSession(resolvedName, xspecRoot);
    if (!session) {
      console.error(chalk.red(`未找到会话: ${resolvedName}`));
      console.error(chalk.gray('请先使用 x-spec sp <描述> 启动 SuperPower 开发'));
      process.exit(1);
    }

    if (session.status === 'COMPLETED') {
      console.log(chalk.yellow(`会话 ${resolvedName} 已完成，spec 已在: ${session.specFile}`));
      return;
    }

    const spinner = ora('生成 spec 沉淀文档...').start();
    try {
      session.status = 'COMPLETED';
      session.completedAt = new Date().toISOString();
      if (opts.message) session.description = `${session.description}\n\n**交付备注**: ${opts.message}`;

      const specFile = router.generateSuperpowerSpec(session, xspecRoot);
      session.specFile = path.relative(root, specFile);
      router.saveSession(session, xspecRoot);

      spinner.succeed('spec 文档已生成');
    } catch (e: any) {
      spinner.fail(e.message);
      process.exit(1);
    }

    console.log();
    console.log(chalk.green('✅ SuperPower 开发完成！'));
    console.log();
    console.log(`  spec 文档: ${chalk.underline(session.specFile)}`);
    console.log(chalk.gray('  此文件记录了本轮交付的功能规范，已纳入项目 spec 体系'));
    console.log();
    console.log(chalk.cyan('下一步建议:'));
    console.log(`  ${chalk.gray('验证规范一致性')}  →  ${chalk.bold(`x-spec verify ${resolvedName}`)}`);
    console.log(`  ${chalk.gray('归档本轮变更')}    →  ${chalk.bold(`x-spec archive ${resolvedName}`)}`);
  });

// ─── 子命令：sp status — 查看 SuperPower 会话列表 ───

spCommand
  .command('status [changeName]')
  .description('查看 SuperPower 会话状态')
  .option('-p, --path <path>', '项目根路径', '.')
  .action(async (changeName: string | undefined, opts) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const xspecRoot = getXSpecRoot(root);
    const router = new ModeRouter();

    if (changeName) {
      const session = router.loadSession(changeName, xspecRoot);
      if (!session) {
        console.log(chalk.gray(`未找到 SuperPower 会话: ${changeName}`));
        return;
      }
      printSessionDetail(session);
    } else {
      const sessions = router.listSessions(xspecRoot);
      if (sessions.length === 0) {
        console.log(chalk.gray('当前没有 SuperPower 会话'));
        console.log(chalk.cyan('使用 x-spec sp <描述> 启动'));
        return;
      }
      console.log(chalk.cyan(`\nSuperPower 会话列表 (${sessions.length} 个):\n`));
      for (const s of sessions) {
        const statusIcon = s.status === 'COMPLETED' ? chalk.green('✅') : chalk.yellow('⚡');
        const statusLabel = s.status === 'COMPLETED' ? '已完成' : s.status === 'SPEC_PENDING' ? '待沉淀' : '开发中';
        console.log(`  ${statusIcon} ${chalk.bold(s.changeName)} — ${statusLabel} (~${s.estimatedLines}行)`);
        console.log(chalk.gray(`     ${s.description.substring(0, 60)}${s.description.length > 60 ? '...' : ''}`));
      }
    }
  });

// ─── 子命令：sp spec — 为已完成的对话式开发补充 spec 沉淀 ───

spCommand
  .command('spec <description>')
  .description('为已完成的开发补充 spec 文档沉淀（适用于对话式开发完成后）')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('-n, --name <name>', '变更名称')
  .option('--lines <n>', '实际代码行数', '50')
  .action(async (description: string, opts) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const xspecRoot = getXSpecRoot(root);
    const router = new ModeRouter();

    const changeName = opts.name || generateChangeName(description);
    const lines = parseInt(opts.lines);

    const session: SuperPowerSession = {
      changeName,
      description,
      estimatedLines: lines,
      createdAt: new Date().toISOString(),
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
    };

    const spinner = ora(`生成 spec 沉淀: ${changeName}`).start();
    try {
      const specFile = router.generateSuperpowerSpec(session, xspecRoot);
      session.specFile = path.relative(root, specFile);
      router.saveSession(session, xspecRoot);
      spinner.succeed('spec 文档已生成');
    } catch (e: any) {
      spinner.fail(e.message);
      process.exit(1);
    }

    console.log();
    console.log(chalk.green(`✅ spec 已沉淀: ${session.specFile}`));
    console.log(chalk.gray('   本轮功能规范已记录，可使用 x-spec verify 进行验证'));
  });

// ─── 辅助函数 ───

function buildThresholds(config: any) {
  const modeConfig = config?.mode || {};
  return {
    conversationalMax: parseInt(modeConfig['conversational-max'] ?? 100),
    superpowerMax: parseInt(modeConfig['superpower-max'] ?? 500),
  };
}

function createSuperpowerProposal(xspecRoot: string, changeName: string, description: string, estimatedLines: number): void {
  const changeDir = path.join(xspecRoot, 'changes', changeName);
  fs.mkdirSync(changeDir, { recursive: true });

  const proposalContent = `# 变更提案: ${changeName}

> **开发模式**: SuperPower 快速交付  
> **估算代码量**: ~${estimatedLines} 行  
> **创建时间**: ${new Date().toLocaleString('zh-CN')}

## 需求描述

${description}

## 动机

快速交付中等规模需求变更。

## 影响范围

待开发完成后填写。

---

> **SuperPower 模式说明**: 此提案跳过了完整的 design.md / tasks.md / 审核流程。  
> 开发完成后请运行 \`x-spec sp done ${changeName}\` 自动生成 spec 沉淀文档。
`;

  writeMarkdown(path.join(changeDir, 'proposal.md'), proposalContent);
  fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true });
}

function generateChangeName(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s\u4e00-\u9fff]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 50) || `sp-${Date.now()}`;
}

function findActiveSuperpowerSession(xspecRoot: string): string | null {
  const sessionsDir = path.join(xspecRoot, 'superpower');
  if (!fs.existsSync(sessionsDir)) return null;
  const sessions = fs
    .readdirSync(sessionsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8')) as SuperPowerSession)
    .filter(s => s.status === 'IMPLEMENTING');
  return sessions[0]?.changeName || null;
}

function printSessionDetail(session: SuperPowerSession): void {
  const statusIcon = session.status === 'COMPLETED' ? '✅' : '⚡';
  const statusLabel: Record<string, string> = {
    IMPLEMENTING: chalk.yellow('开发中'),
    SPEC_PENDING: chalk.cyan('待沉淀'),
    COMPLETED: chalk.green('已完成'),
  };
  console.log(`\nSuperPower 会话: ${chalk.bold(session.changeName)}`);
  console.log(`  状态:     ${statusLabel[session.status]}`);
  console.log(`  估算行数: ~${session.estimatedLines} 行`);
  console.log(`  描述:     ${session.description}`);
  console.log(`  创建时间: ${new Date(session.createdAt).toLocaleString('zh-CN')}`);
  if (session.completedAt) {
    console.log(`  完成时间: ${new Date(session.completedAt).toLocaleString('zh-CN')}`);
  }
  if (session.specFile) {
    console.log(`  Spec 文件: ${chalk.underline(session.specFile)}`);
  }
  if (session.status === 'IMPLEMENTING') {
    console.log();
    console.log(chalk.cyan('  完成开发后运行:'));
    console.log(`    x-spec sp done ${session.changeName}`);
  }
}
