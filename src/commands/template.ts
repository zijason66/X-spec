import { Command } from 'commander';
import chalk from 'chalk';
import { TemplateEngine } from '../core/template-engine.js';
import { resolveProjectRoot, ensureInitialized } from '../utils.js';

export const templateCommand = new Command('template')
  .description('代码仓库模板化处理');

templateCommand
  .command('extract <source-path>')
  .description('从现有代码提取模板')
  .requiredOption('-n, --name <name>', '模板名称')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('-v, --variables <vars>', '模板变量（逗号分隔）')
  .action(async (sourcePath: string, opts: any) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const engine = new TemplateEngine(root);

    try {
      engine.extractTemplate(sourcePath, opts.name, opts.variables);
      console.log(chalk.green(`✓ 模板 '${opts.name}' 已从 ${sourcePath} 提取`));
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });

templateCommand
  .command('apply <template-name>')
  .description('应用模板生成代码')
  .requiredOption('-o, --output <path>', '输出路径')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('-V, --var <vars...>', '变量值 (key=value格式)')
  .action(async (templateName: string, opts: any) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const engine = new TemplateEngine(root);

    const varMap: Record<string, string> = {};
    if (opts.var) {
      for (const v of opts.var) {
        const [key, ...rest] = v.split('=');
        varMap[key] = rest.join('=');
      }
    }

    try {
      engine.applyTemplate(templateName, opts.output, varMap);
      console.log(chalk.green(`✓ 模板 '${templateName}' 已应用到 ${opts.output}`));
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });

templateCommand
  .command('list')
  .description('列出可用模板')
  .option('-p, --path <path>', '项目根路径', '.')
  .action(async (opts: any) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const engine = new TemplateEngine(root);
    const templates = engine.listTemplates();

    if (templates.length === 0) {
      console.log(chalk.gray('暂无可用模板'));
      return;
    }

    console.log(chalk.cyan('可用模板:'));
    for (const t of templates) {
      console.log(`  ${(t.name || '').padEnd(30)} ${t['source-path'] || ''}`);
    }
  });
