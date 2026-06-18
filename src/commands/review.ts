/**
 * x-spec review — 方案审核命令
 *
 * 子命令：
 *   x-spec review <changeName>           — 对指定提案执行自动审核（1-3轮）
 *   x-spec review approve <changeName>   — 人工确认批准
 *   x-spec review reject  <changeName>   — 人工驳回
 *   x-spec review status  <changeName>   — 查看当前审核状态
 */

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'node:path';
import fs from 'node:fs';
import ora from 'ora';
import { resolveProjectRoot, getXSpecRoot, ensureInitialized, loadConfig } from '../utils.js';
import { ProposalReviewer, DEFAULT_REVIEW_CONFIG } from '../core/proposal-reviewer.js';
import type { ReviewConfig } from '../types.js';

// ─── 主命令：执行自动审核 ───

export const reviewCommand = new Command('review')
  .description('对变更提案执行自动方案审核（1-3轮 subagent 审核 + 人工确认）')
  .argument('[changeName]', '变更名称（默认使用活动变更）')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('--rounds <n>', '最多审核轮数（1-3）', '3')
  .option('--min-rounds <n>', '最少审核轮数', '1')
  .option('--auto-approve-score <n>', '自动通过的最低分数（0-100）', '80')
  .option('--no-human-approval', '跳过人工确认（自动审核通过即可进入编码）')
  .option('--skip-auto', '跳过自动审核，直接进入人工确认等待')
  .action(async (changeName: string | undefined, opts) => {
    const root = resolveProjectRoot(opts.path);
    const config = ensureInitialized(root);
    const xspecRoot = getXSpecRoot(root);

    // 解析变更名称
    const resolvedName = changeName || findActiveChange(xspecRoot);
    if (!resolvedName) {
      console.error(chalk.red('未找到活动变更提案，请指定变更名称'));
      process.exit(1);
    }

    const changeDir = path.join(xspecRoot, 'changes', resolvedName);
    if (!fs.existsSync(changeDir)) {
      console.error(chalk.red(`变更提案不存在: ${resolvedName}`));
      process.exit(1);
    }

    // 构建审核配置
    const reviewCfg = buildReviewConfig(config, opts);
    const reviewer = new ProposalReviewer(changeDir, reviewCfg);

    // 加载或初始化审核状态
    let state = reviewer.loadState() || reviewer.initState(resolvedName);

    // 已批准则直接提示
    if (state.status === 'APPROVED') {
      console.log(chalk.green(`\n✅ 提案 ${resolvedName} 已批准，可执行 x-spec apply ${resolvedName}`));
      return;
    }

    if (opts.skipAuto) {
      // 直接进入等待人工确认
      reviewer.markAwaitingHuman(state);
      printAwaitingHumanPrompt(resolvedName);
      return;
    }

    console.log(chalk.cyan(`\n─── 方案自动审核: ${resolvedName} ───`));
    console.log(chalk.gray(`配置: 最少 ${reviewCfg.minRounds} 轮 / 最多 ${reviewCfg.maxRounds} 轮 / 通过分数 ≥ ${reviewCfg.autoApproveScore}`));
    console.log();

    // ── 执行审核循环 ──
    let lastRound = null;
    while (true) {
      const spinner = ora(`第 ${state.currentRound + 1}/${state.maxRounds} 轮审核中...`).start();
      try {
        lastRound = await reviewer.runReviewRound(state);
        state = reviewer.loadState()!;
        spinner.stop();
      } catch (e: any) {
        spinner.fail(`审核异常: ${e.message}`);
        process.exit(1);
      }

      if (!reviewer.shouldContinueReview(state, lastRound)) break;

      console.log(chalk.yellow('\n  → 需要修订，准备下一轮审核...'));
      console.log(chalk.gray('  提示：请根据上方审核意见修改提案文件，修改完成后审核将自动继续'));
      // 实际场景：等待人工修改文件后按任意键继续（此处直接继续，避免阻塞自动化流程）
      await waitForRevision(changeDir, state.currentRound);
    }

    // ── 审核循环结束 ──
    console.log(chalk.cyan('\n─── 自动审核完成 ───\n'));
    console.log(`最终评分: ${chalk.bold(lastRound!.score + '/100')}`);
    console.log(`最终结论: ${formatVerdict(lastRound!.verdict)}`);
    console.log(`审核报告: ${chalk.underline(path.relative(root, path.join(changeDir, 'review-report.md')))}`);

    if (lastRound!.verdict === 'REJECTED' && state.currentRound >= state.maxRounds) {
      console.log(chalk.red('\n❌ 方案质量不达标，建议重新设计后重新发起提案'));
      reviewer.generateReport(state);
      process.exit(1);
    }

    // 进入人工确认等待
    if (reviewCfg.requireHumanApproval) {
      reviewer.markAwaitingHuman(state);
      printAwaitingHumanPrompt(resolvedName);
    } else {
      // 不需要人工审批，直接标记通过
      reviewer.humanApprove(state, '（自动审核通过，无需人工确认）');
      console.log(chalk.green('\n✅ 自动审核通过，可执行编码实现:'));
      console.log(chalk.cyan(`  x-spec apply ${resolvedName}`));
    }
  });

// ─── 子命令：approve ───

reviewCommand
  .command('approve <changeName>')
  .description('人工确认批准提案，允许进入编码实现阶段')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('-m, --message <msg>', '审批备注')
  .action(async (changeName: string, opts) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const xspecRoot = getXSpecRoot(root);
    const changeDir = path.join(xspecRoot, 'changes', changeName);

    if (!fs.existsSync(changeDir)) {
      console.error(chalk.red(`变更提案不存在: ${changeName}`));
      process.exit(1);
    }

    const reviewer = new ProposalReviewer(changeDir);
    const state = reviewer.loadState();

    if (!state) {
      console.error(chalk.red('审核状态不存在，请先执行 x-spec review'));
      process.exit(1);
    }

    if (state.status === 'APPROVED') {
      console.log(chalk.yellow(`提案 ${changeName} 已经处于批准状态`));
      return;
    }

    reviewer.humanApprove(state, opts.message);

    console.log(chalk.green(`\n✅ 提案已批准: ${changeName}`));
    if (opts.message) console.log(chalk.gray(`   备注: ${opts.message}`));
    console.log();
    console.log(chalk.cyan('下一步：开始编码实现'));
    console.log(`  ${chalk.bold(`x-spec apply ${changeName}`)}`);
  });

// ─── 子命令：reject ───

reviewCommand
  .command('reject <changeName>')
  .description('人工驳回提案，需要重新设计')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('-m, --message <msg>', '驳回原因', '需要重新设计')
  .action(async (changeName: string, opts) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const xspecRoot = getXSpecRoot(root);
    const changeDir = path.join(xspecRoot, 'changes', changeName);

    if (!fs.existsSync(changeDir)) {
      console.error(chalk.red(`变更提案不存在: ${changeName}`));
      process.exit(1);
    }

    const reviewer = new ProposalReviewer(changeDir);
    const state = reviewer.loadState();

    if (!state) {
      console.error(chalk.red('审核状态不存在，请先执行 x-spec review'));
      process.exit(1);
    }

    reviewer.humanReject(state, opts.message);

    console.log(chalk.red(`\n❌ 提案已驳回: ${changeName}`));
    console.log(chalk.gray(`   原因: ${opts.message}`));
    console.log();
    console.log(chalk.yellow('建议：重新设计后使用 x-spec propose 发起新的变更提案'));
  });

// ─── 子命令：status ───

reviewCommand
  .command('status [changeName]')
  .description('查看提案审核状态')
  .option('-p, --path <path>', '项目根路径', '.')
  .action(async (changeName: string | undefined, opts) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const xspecRoot = getXSpecRoot(root);

    const resolvedName = changeName || findActiveChange(xspecRoot);
    if (!resolvedName) {
      console.error(chalk.red('未找到活动变更'));
      process.exit(1);
    }

    const changeDir = path.join(xspecRoot, 'changes', resolvedName);
    const reviewer = new ProposalReviewer(changeDir);
    const state = reviewer.loadState();

    if (!state) {
      console.log(chalk.gray(`提案 ${resolvedName} 尚未进行审核`));
      console.log(chalk.cyan(`  执行: x-spec review ${resolvedName}`));
      return;
    }

    const statusColors: Record<string, chalk.Chalk> = {
      PENDING_REVIEW: chalk.gray,
      IN_REVIEW: chalk.yellow,
      APPROVED: chalk.green,
      REJECTED: chalk.red,
      AWAITING_HUMAN: chalk.cyan,
    };
    const statusLabel: Record<string, string> = {
      PENDING_REVIEW: '待审核',
      IN_REVIEW: '审核中',
      APPROVED: '已批准',
      REJECTED: '已驳回',
      AWAITING_HUMAN: '等待人工确认',
    };

    const colorFn = statusColors[state.status] || chalk.white;
    console.log(`\n提案审核状态: ${chalk.bold(resolvedName)}`);
    console.log(`  状态: ${colorFn(statusLabel[state.status] || state.status)}`);
    console.log(`  轮次: ${state.currentRound}/${state.maxRounds}`);

    if (state.rounds.length > 0) {
      console.log(`\n  审核历史:`);
      for (const r of state.rounds) {
        const verdictIcon = { APPROVED: '✅', NEEDS_REVISION: '🔄', REJECTED: '❌' }[r.verdict];
        console.log(`    R${r.round}: ${verdictIcon} ${r.score}/100 — ${r.summary.substring(0, 60)}...`);
      }
    }

    if (state.status === 'AWAITING_HUMAN') {
      console.log();
      console.log(chalk.cyan('  → 等待人工审批:'));
      console.log(`     x-spec review approve ${resolvedName}`);
      console.log(`     x-spec review reject  ${resolvedName} -m "原因"`);
    } else if (state.status === 'APPROVED') {
      console.log();
      console.log(chalk.green('  → 已批准，可开始编码:'));
      console.log(`     x-spec apply ${resolvedName}`);
    }
  });

// ─── 辅助函数 ───

function buildReviewConfig(config: any, opts: any): ReviewConfig {
  const fromYml = config?.review || {};
  return {
    enabled: true,
    minRounds: parseInt(opts.minRounds || fromYml['min-rounds'] || DEFAULT_REVIEW_CONFIG.minRounds),
    maxRounds: Math.min(3, parseInt(opts.rounds || fromYml['max-rounds'] || DEFAULT_REVIEW_CONFIG.maxRounds)),
    autoApproveScore: parseInt(opts.autoApproveScore || fromYml['auto-approve-score'] || DEFAULT_REVIEW_CONFIG.autoApproveScore),
    autoReviewOnPropose: fromYml['auto-review-on-propose'] ?? DEFAULT_REVIEW_CONFIG.autoReviewOnPropose,
    requireHumanApproval: opts.humanApproval !== false && (fromYml['require-human-approval'] ?? DEFAULT_REVIEW_CONFIG.requireHumanApproval),
    reviewDimensions: fromYml['review-dimensions'] || DEFAULT_REVIEW_CONFIG.reviewDimensions,
  };
}

function findActiveChange(xspecRoot: string): string | null {
  const changesDir = path.join(xspecRoot, 'changes');
  if (!fs.existsSync(changesDir)) return null;
  const dirs = fs.readdirSync(changesDir).filter(f =>
    fs.statSync(path.join(changesDir, f)).isDirectory()
  );
  return dirs[0] || null;
}

function printAwaitingHumanPrompt(changeName: string): void {
  console.log(chalk.cyan('\n─── 等待人工确认 ───'));
  console.log();
  console.log('自动审核已完成，请查阅审核报告：');
  console.log(chalk.underline(`  x-spec/changes/${changeName}/review-report.md`));
  console.log();
  console.log('确认无误后，执行以下命令批准方案并开始编码：');
  console.log();
  console.log(`  ${chalk.green('✓ 批准')}  ${chalk.bold(`x-spec review approve ${changeName}`)}`);
  console.log(`  ${chalk.red('✗ 驳回')}  ${chalk.bold(`x-spec review reject  ${changeName} -m "驳回原因"`)}`);
  console.log();
}

function formatVerdict(verdict: string): string {
  const map: Record<string, string> = {
    APPROVED: chalk.green('通过 ✅'),
    NEEDS_REVISION: chalk.yellow('需要修订 🔄'),
    REJECTED: chalk.red('驳回 ❌'),
  };
  return map[verdict] || verdict;
}

async function waitForRevision(changeDir: string, completedRounds: number): Promise<void> {
  // 检查是否存在 review-revision-r{n}.md 标记文件（人工修改完成后创建）
  // 在自动化流程中直接继续；在人工介入场景中通过 stdin 等待
  const revisionMarker = path.join(changeDir, `review-revision-r${completedRounds}.md`);
  if (!process.stdin.isTTY) return; // CI/自动化环境直接继续

  // 等待用户确认已修改完毕
  console.log(chalk.gray('\n  修改完成后按 Enter 继续下一轮审核，或输入 skip 跳过剩余轮次...'));
  const input = await readLine();
  if (input.trim().toLowerCase() === 'skip') {
    fs.writeFileSync(revisionMarker, `跳过剩余审核轮次 — ${new Date().toISOString()}`);
  }
}

function readLine(): Promise<string> {
  return new Promise(resolve => {
    process.stdin.once('data', data => resolve(data.toString()));
  });
}
