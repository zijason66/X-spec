import { Command } from 'commander';
import chalk from 'chalk';
import { SpecEngine } from '../core/spec-engine.js';
import { resolveProjectRoot, ensureInitialized } from '../utils.js';

export const verifyCommand = new Command('verify')
  .description('验证实现与OpenSpec规范的一致性')
  .argument('[change-name]', '变更名称')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('--strict', '严格模式：所有场景必须完全匹配')
  .action(async (changeName?: string, opts?: any) => {
    const root = resolveProjectRoot(opts?.path);
    ensureInitialized(root);
    const engine = new SpecEngine(root);

    console.log(chalk.cyan(`\n验证规范一致性${changeName ? ': ' + changeName : ''}\n`));

    const result = engine.verify(changeName, opts?.strict);

    if (result.consistent) {
      console.log(chalk.green(`✓ 实现与规范保持一致 (${result.totalScenarios} 个场景验证通过)`));
    } else {
      console.log(chalk.red(`✗ 发现 ${result.deviations.length} 项规范偏差:\n`));
      for (const d of result.deviations) {
        const icon = d.severity === 'ERROR' ? '✗' : d.severity === 'WARNING' ? '⚠' : 'ℹ';
        console.log(`  ${icon} [${d.severity}] ${d.message}`);
      }
      process.exit(1);
    }
  });
