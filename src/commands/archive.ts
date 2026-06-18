import { Command } from 'commander';
import chalk from 'chalk';
import { SpecEngine } from '../core/spec-engine.js';
import { resolveProjectRoot, getXSpecRoot, ensureInitialized } from '../utils.js';

export const archiveCommand = new Command('archive')
  .description('归档已完成的变更提案，合并规范增量')
  .argument('[change-name]', '变更名称')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('--bulk', '批量归档所有已完成变更')
  .action(async (changeName?: string, opts?: any) => {
    const root = resolveProjectRoot(opts?.path);
    ensureInitialized(root);
    const xspecRoot = getXSpecRoot(root);

    if (opts?.bulk) {
      const engine = new SpecEngine(root);
      const changesDir = `${xspecRoot}/changes`;
      const fs = await import('node:fs');
      const path = await import('node:path');
      let count = 0;

      if (fs.existsSync(changesDir)) {
        for (const dir of fs.readdirSync(changesDir)) {
          const statusFile = path.join(changesDir, dir, '.status');
          if (fs.existsSync(statusFile)) {
            const status = fs.readFileSync(statusFile, 'utf-8').trim();
            if (status === 'COMPLETED') {
              engine.archiveChange(dir);
              count++;
            }
          }
        }
      }

      console.log(chalk.green(`✓ 已批量归档 ${count} 个变更`));
      return;
    }

    if (!changeName) {
      console.error(chalk.red('请指定变更名称或使用 --bulk'));
      process.exit(1);
    }

    try {
      new SpecEngine(root).archiveChange(changeName);
      console.log(chalk.green(`✓ 变更 '${changeName}' 已归档`));
      console.log(chalk.gray('规范文件已更新（spec delta已合并）'));
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });
