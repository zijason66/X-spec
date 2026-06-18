/**
 * x-spec mode — 开发模式评估与推荐命令
 *
 * 根据需求描述智能评估代码量，推荐合适的开发模式：
 *   CONVERSATIONAL : <100行  → 直接对话式
 *   SUPERPOWER     : 100-500行 → SuperPower 快速交付
 *   SDD            : >500行  → 完整规范驱动开发
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { ModeRouter, MODE_DISPLAY } from '../core/mode-router.js';
import { resolveProjectRoot, ensureInitialized } from '../utils.js';
import type { DevMode } from '../types.js';

export const modeCommand = new Command('mode')
  .description('智能评估需求复杂度，推荐合适的开发模式（对话式 / SuperPower / SDD）')
  .argument('[description]', '需求描述（不填则显示模式说明）')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('--lines <n>', '手动指定估算代码行数')
  .option('--thresholds', '显示当前模式阈值配置')
  .action(async (description: string | undefined, opts) => {
    const root = resolveProjectRoot(opts.path);
    const config = ensureInitialized(root);

    const modeConfig = (config as any)?.mode || {};
    const router = new ModeRouter({
      conversationalMax: parseInt(modeConfig['conversational-max'] ?? 100),
      superpowerMax: parseInt(modeConfig['superpower-max'] ?? 500),
    });

    // 显示阈值配置
    if (opts.thresholds) {
      const thresholds = {
        conversationalMax: parseInt(modeConfig['conversational-max'] ?? 100),
        superpowerMax: parseInt(modeConfig['superpower-max'] ?? 500),
      };
      console.log(chalk.cyan('\n─── 开发模式阈值配置 ───'));
      console.log(`  💬 对话式  : < ${thresholds.conversationalMax} 行`);
      console.log(`  ⚡ SuperPower: ${thresholds.conversationalMax} - ${thresholds.superpowerMax} 行`);
      console.log(`  📋 SDD      : ≥ ${thresholds.superpowerMax} 行`);
      console.log();
      console.log(chalk.gray('可在 x-spec.yml 的 mode 节中调整阈值'));
      return;
    }

    // 无描述时展示模式对比说明
    if (!description) {
      printModeOverview();
      return;
    }

    // 评估并推荐
    const estimate = opts.lines
      ? router.override(description, router.routeMode(parseInt(opts.lines)))
      : router.estimate(description);

    router.printRecommendation(estimate);

    // 根据推荐模式给出具体操作指引
    console.log(chalk.cyan('─── 推荐操作 ───'));
    console.log();
    printNextSteps(estimate.recommendedMode, description);
  });

// ─── 辅助函数 ───

function printModeOverview(): void {
  console.log(chalk.cyan('\n═══ x-spec 开发模式说明 ═══\n'));

  const modes: DevMode[] = ['CONVERSATIONAL', 'SUPERPOWER', 'SDD'];
  for (const mode of modes) {
    const { label, icon, description } = MODE_DISPLAY[mode];
    console.log(`${icon}  ${chalk.bold(label)}`);
    console.log(description);
    console.log();
  }

  console.log(chalk.cyan('─── 模式选择规则 ───'));
  console.log('  💬 对话式   → 估算代码量 < 100 行');
  console.log('  ⚡ SuperPower → 估算代码量 100 - 500 行');
  console.log('  📋 SDD      → 估算代码量 > 500 行');
  console.log();
  console.log(chalk.gray('评估需求: x-spec mode "你的需求描述"'));
  console.log(chalk.gray('查看阈值: x-spec mode --thresholds'));
}

function printNextSteps(mode: DevMode, description: string): void {
  switch (mode) {
    case 'CONVERSATIONAL':
      console.log(chalk.blue('  💬 直接与 AI 对话实现需求'));
      console.log(chalk.gray(`     描述你的需求: "${description}"`));
      console.log();
      console.log(chalk.gray('  完成后如需沉淀规范文档:'));
      console.log(chalk.blue(`  x-spec sp spec "${description}" --name <变更名>`));
      break;

    case 'SUPERPOWER':
      console.log(chalk.yellow(`  ⚡ 使用 SuperPower 快速开发:`));
      console.log(chalk.bold(`  x-spec sp "${description}"`));
      console.log();
      console.log(chalk.gray('  开发完成后沉淀 spec:'));
      console.log(chalk.yellow('  x-spec sp done <变更名>'));
      break;

    case 'SDD':
      console.log(chalk.green(`  📋 使用完整 SDD 流程:`));
      console.log(chalk.bold(`  x-spec propose "${description}"`));
      console.log();
      console.log(chalk.gray('  完整流程：提案→审核→人工确认→编码→验证→归档'));
      break;
  }
  console.log();
}
