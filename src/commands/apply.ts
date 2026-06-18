import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import { SpecEngine } from '../core/spec-engine.js';
import { ProposalReviewer } from '../core/proposal-reviewer.js';
import { resolveProjectRoot, ensureInitialized, getXSpecRoot, loadConfig } from '../utils.js';

export const applyCommand = new Command('apply')
  .description('按tasks.md逐项执行变更任务（需方案审核通过）')
  .argument('[change-name]', '变更名称')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('--dry-run', '仅展示执行计划，不实际修改')
  .option('--skip-review-check', '跳过审核状态检查（谨慎使用）')
  .action(async (changeName?: string, opts?: any) => {
    const root = resolveProjectRoot(opts?.path);
    const config = ensureInitialized(root);
    const xspecRoot = getXSpecRoot(root);
    const engine = new SpecEngine(root);

    if (!changeName) {
      changeName = engine.findActiveChange() || undefined;
      if (!changeName) {
        console.error(chalk.red('未找到活动变更，请指定变更名称'));
        process.exit(1);
      }
    }

    // ── 审核状态检查 ──
    if (!opts?.skipReviewCheck && !opts?.dryRun) {
      const reviewRequired = (config as any)?.review?.['require-human-approval'] ?? true;
      if (reviewRequired) {
        const changeDir = path.join(xspecRoot, 'changes', changeName);
        const reviewer = new ProposalReviewer(changeDir);
        const state = reviewer.loadState();

        if (!state) {
          console.error(chalk.red('\n❌ 方案尚未经过审核'));
          console.log(chalk.yellow('请先执行方案审核:'));
          console.log(chalk.cyan(`  x-spec review ${changeName}`));
          process.exit(1);
        }

        if (!reviewer.isApprovedForImplementation(state)) {
          const statusLabels: Record<string, string> = {
            PENDING_REVIEW: '待审核',
            IN_REVIEW: '审核中',
            AWAITING_HUMAN: '等待人工确认',
            REJECTED: '已驳回',
          };
          const statusText = statusLabels[state.status] || state.status;
          console.error(chalk.red(`\n❌ 方案未获批准（当前状态: ${statusText}）`));
          if (state.status === 'AWAITING_HUMAN') {
            console.log(chalk.yellow('需要人工确认后才能开始编码:'));
            console.log(chalk.cyan(`  x-spec review approve ${changeName}`));
          } else if (state.status === 'REJECTED') {
            console.log(chalk.red('方案已被驳回，请重新设计后发起新提案'));
          } else {
            console.log(chalk.cyan(`  x-spec review ${changeName}`));
          }
          process.exit(1);
        }

        console.log(chalk.green('✓ 方案审核已通过'));
      }
    }

    console.log(chalk.cyan(`\n执行变更: ${changeName}${opts?.dryRun ? ' (dry-run)' : ''}\n`));

    try {
      engine.applyChange(changeName, opts?.dryRun);
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }

    if (!opts?.dryRun) {
      console.log(chalk.yellow('\n开始执行任务...'));
      console.log(chalk.gray('按 tasks.md 逐项完成，使用 x-spec verify 验证后 x-spec archive 归档'));
    }
  });
