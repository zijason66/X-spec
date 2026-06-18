import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import { SpecEngine } from '../core/spec-engine.js';
import { ProposalReviewer, DEFAULT_REVIEW_CONFIG } from '../core/proposal-reviewer.js';
import { resolveProjectRoot, getXSpecRoot, ensureInitialized, writeMarkdown, loadConfig } from '../utils.js';
import type { KnowledgeContext, ReviewConfig } from '../types.js';

export const proposeCommand = new Command('propose')
  .description('发起变更提案，生成OpenSpec结构化变更文档包')
  .argument('<description>', '变更描述')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('-n, --name <name>', '变更名称（自动生成则留空）')
  .option('--skip-knowledge-check', '跳过知识注入检查')
  .option('--skip-review', '跳过自动审核，仅生成提案文件')
  .action(async (description: string, opts) => {
    const root = resolveProjectRoot(opts.path);
    const config = ensureInitialized(root);
    const xspecRoot = getXSpecRoot(root);

    // 检查知识注入状态
    if (!opts.skipKnowledgeCheck && config.sdd?.['knowledge-required'] !== false) {
      const summaryPath = path.join(xspecRoot, 'knowledge', 'summary.md');
      if (!fs.existsSync(summaryPath)) {
        console.log(chalk.yellow('\n⚠ 项目知识尚未注入'));
        console.log(chalk.gray('建议先执行 x-spec knowledge 注入项目上下文，确保提案基于完整的知识理解。'));
        console.log(chalk.gray('使用 --skip-knowledge-check 跳过此检查。\n'));
        process.exit(1);
      }
    }

    const changeName = opts.name || generateChangeName(description);
    const engine = new SpecEngine(root);

    // 收集知识上下文
    const knowledgeCtx = collectKnowledgeContext(xspecRoot);

    const spinner = ora(`生成变更提案: ${changeName}`).start();

    try {
      engine.createProposal(description, changeName, knowledgeCtx);
      spinner.succeed('变更提案已生成');
    } catch (e: any) {
      spinner.fail(e.message);
      process.exit(1);
    }

    const changeDir = path.join(xspecRoot, 'changes', changeName);

    console.log();
    console.log(chalk.cyan(`路径: x-spec/changes/${changeName}/`));
    console.log('  ├── proposal.md       ← 变更描述与意图');
    console.log('  ├── design.md         ← 技术设计决策');
    console.log('  ├── tasks.md          ← 实现任务分解');
    if (knowledgeCtx) console.log('  ├── knowledge-ref.md  ← 知识上下文引用');
    console.log('  └── specs/            ← 规范增量');
    console.log();

    // ── 自动审核流程 ──
    const reviewCfgFromYml = (config as any)?.review || {};
    const autoReviewEnabled = reviewCfgFromYml['auto-review-on-propose'] ?? DEFAULT_REVIEW_CONFIG.autoReviewOnPropose;

    if (!opts.skipReview && autoReviewEnabled) {
      await runAutoReview(changeName, changeDir, config);
    } else {
      console.log(chalk.yellow('请审查提案后使用 x-spec review 执行方案审核，或直接使用 x-spec apply 执行'));
    }
  });

// ─── 自动审核流程 ───

async function runAutoReview(changeName: string, changeDir: string, config: any): Promise<void> {
  const reviewCfgFromYml = config?.review || {};
  const reviewCfg: ReviewConfig = {
    enabled: true,
    minRounds: parseInt(reviewCfgFromYml['min-rounds'] ?? DEFAULT_REVIEW_CONFIG.minRounds),
    maxRounds: Math.min(3, parseInt(reviewCfgFromYml['max-rounds'] ?? DEFAULT_REVIEW_CONFIG.maxRounds)),
    autoApproveScore: parseInt(reviewCfgFromYml['auto-approve-score'] ?? DEFAULT_REVIEW_CONFIG.autoApproveScore),
    autoReviewOnPropose: true,
    requireHumanApproval: reviewCfgFromYml['require-human-approval'] ?? DEFAULT_REVIEW_CONFIG.requireHumanApproval,
    reviewDimensions: reviewCfgFromYml['review-dimensions'] || DEFAULT_REVIEW_CONFIG.reviewDimensions,
  };

  const reviewer = new ProposalReviewer(changeDir, reviewCfg);
  let state = reviewer.initState(changeName);

  console.log(chalk.cyan('─── 自动方案审核（Subagent）───'));
  console.log(chalk.gray(`规则: 最少 ${reviewCfg.minRounds} 轮 / 最多 ${reviewCfg.maxRounds} 轮 / 通过分数 ≥ ${reviewCfg.autoApproveScore}`));

  let lastRound = null;
  while (true) {
    lastRound = await reviewer.runReviewRound(state);
    state = reviewer.loadState()!;

    if (!reviewer.shouldContinueReview(state, lastRound)) break;

    console.log(chalk.yellow('\n  → 发现可改进问题，自动进入下一轮审核'));
    console.log(chalk.gray('  （如需手动修改提案文件，请编辑后按 Enter 继续）'));

    if (process.stdin.isTTY) {
      await new Promise<void>(resolve => process.stdin.once('data', () => resolve()));
    }
  }

  console.log(chalk.cyan('\n─── 审核完成 ───'));

  if (reviewCfg.requireHumanApproval) {
    reviewer.markAwaitingHuman(state);
    console.log();
    console.log(`最终评分: ${chalk.bold(lastRound!.score + '/100')}`);
    console.log(`审核报告: ${chalk.underline(`x-spec/changes/${changeName}/review-report.md`)}`);
    console.log();
    console.log(chalk.cyan('方案审核完成，等待人工确认：'));
    console.log(`  ${chalk.green('批准并开始编码')}  →  ${chalk.bold(`x-spec review approve ${changeName}`)}`);
    console.log(`  ${chalk.red('驳回重新设计')}    →  ${chalk.bold(`x-spec review reject  ${changeName} -m "原因"`)}`);
    console.log(`  ${chalk.gray('查看审核详情')}    →  ${chalk.bold(`x-spec review status  ${changeName}`)}`);
  } else {
    if (reviewer.isApprovedForImplementation(state)) {
      reviewer.humanApprove(state, '自动审核通过');
      console.log(chalk.green('\n✅ 方案自动通过，可直接开始编码:'));
      console.log(chalk.cyan(`  x-spec apply ${changeName}`));
    } else {
      reviewer.markAwaitingHuman(state);
      console.log(chalk.yellow('\n⚠ 方案未达到自动通过标准，需要人工介入:'));
      console.log(`  ${chalk.bold(`x-spec review approve ${changeName}`)}`);
    }
  }
}

function generateChangeName(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 50) || `change-${Date.now()}`;
}

function collectKnowledgeContext(xspecRoot: string): KnowledgeContext | undefined {
  const knowledgeDir = path.join(xspecRoot, 'knowledge');
  const readIf = (name: string): string | null => {
    const p = path.join(knowledgeDir, name);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
  };
  const ctx: KnowledgeContext = {
    business: readIf('business.md'),
    techStack: readIf('tech-stack.md'),
    api: readIf('api.md'),
    sdk: readIf('sdk.md'),
  };

  // 收集 MCP 外部知识源注入的文件
  const builtinFiles = new Set(['business.md', 'tech-stack.md', 'api.md', 'sdk.md', 'summary.md', 'README.md']);
  const external: Record<string, string> = {};
  if (fs.existsSync(knowledgeDir)) {
    for (const f of fs.readdirSync(knowledgeDir)) {
      if (f.endsWith('.md') && !builtinFiles.has(f)) {
        const content = readIf(f);
        if (content) external[f] = content;
      }
    }
  }
  if (Object.keys(external).length > 0) {
    ctx.external = external;
  }

  if (!ctx.business && !ctx.techStack && !ctx.api && !ctx.sdk && !ctx.external) return undefined;
  return ctx;
}
