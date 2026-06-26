import { Command } from 'commander';
import chalk from 'chalk';
import { resolveProjectRoot, ensureInitialized } from '../utils.js';
import { InitTemplateEngine, DEFAULT_TEMPLATE_NAME } from '../core/init-template-engine.js';

export const initTemplateCommand = new Command('init-template')
  .description('管理 init 渲染模板（控制 knowledge 索引文件的渲染格式）');

// ─── list: 列出所有模板 ───

initTemplateCommand
  .command('list')
  .description('列出所有可用的 init 渲染模板')
  .option('-p, --path <path>', '项目根路径', '.')
  .action((opts) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const engine = new InitTemplateEngine(root);
    const templates = engine.listTemplates();

    if (templates.length === 0) {
      console.log(chalk.gray('暂无 init 渲染模板，请先执行 x-spec init'));
      return;
    }

    console.log(chalk.cyan('\nInit 渲染模板列表:\n'));
    for (const t of templates) {
      const isDefault = t.name === DEFAULT_TEMPLATE_NAME;
      const marker = isDefault ? chalk.green(' (默认)') : '';
      console.log(`  ${chalk.yellow(t.name.padEnd(20))}${marker}`);
      console.log(`  ${''.padEnd(20)} ${t.description}`);
      console.log(`  ${''.padEnd(20)} v${t.version} | 输出 ${t.outputCount} | 省略 ${t.omittedCount} | 静态文件 ${t.staticFileCount} | ${t.dir}`);
      console.log();
    }
  });

// ─── create: 创建新模板 ───

initTemplateCommand
  .command('create <name>')
  .description('创建新的 init 渲染模板（从 default 派生）')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('-d, --description <desc>', '模板描述')
  .action((name: string, opts) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const engine = new InitTemplateEngine(root);

    try {
      const manifest = engine.createTemplate(name, opts.description);
      console.log(chalk.green(`\n✓ Init 渲染模板 '${name}' 已创建`));
      console.log(chalk.gray(`  描述: ${manifest.description}`));
      console.log(chalk.gray(`  版本: ${manifest.version}`));
      console.log(chalk.gray(`  路径: x-spec/templates/init/${name}/`));
      console.log();
      console.log(chalk.cyan('下一步:'));
      console.log(`  1. 编辑 ${chalk.gray(`x-spec/templates/init/${name}/template.yml`)} 调整 outputs 策略`);
      console.log(`     - default: 用内置扫描渲染器`);
      console.log(`     - file:./xxx.md: 用模板目录下静态文件`);
      console.log(`     - omit: 不输出该索引`);
      console.log(`  2. 若使用 file 策略，在模板目录下放对应 .md 文件`);
      console.log(`  3. 初始化时指定: ${chalk.cyan(`x-spec init --init-template ${name}`)}`);
      console.log();
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });

// ─── show: 查看模板详情 ───

initTemplateCommand
  .command('show <name>')
  .description('查看指定模板的配置详情')
  .option('-p, --path <path>', '项目根路径', '.')
  .action((name: string, opts) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const engine = new InitTemplateEngine(root);

    try {
      const { manifest, outputs } = engine.showTemplate(name);
      console.log(chalk.cyan('\nInit 渲染模板详情:\n'));
      console.log(`  ${chalk.yellow('名称')}: ${manifest.name}`);
      console.log(`  ${chalk.yellow('描述')}: ${manifest.description}`);
      console.log(`  ${chalk.yellow('版本')}: ${manifest.version}`);
      console.log(`  ${chalk.yellow('路径')}: ${manifest.dir}`);
      console.log(`  ${chalk.yellow('输出')}: ${manifest.outputCount} 个 | 省略 ${manifest.omittedCount} | 静态文件 ${manifest.staticFileCount}`);
      console.log();
      console.log(chalk.cyan('outputs 策略:'));
      console.log();
      console.log(`  ${'key'.padEnd(16)}${'文件名'.padEnd(20)}${'策略'.padEnd(28)}标题`);
      console.log(`  ${'-'.repeat(16)}${'-'.repeat(20)}${'-'.repeat(28)}${'-'.repeat(20)}`);
      for (const o of outputs) {
        const strategy = o.strategy === 'default' ? chalk.green('default') :
          o.strategy === 'omit' ? chalk.red('omit') :
          chalk.blue(o.strategy);
        console.log(`  ${o.key.padEnd(16)}${o.filename.padEnd(20)}${strategy.padEnd(28)}${o.title}`);
      }
      console.log();
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });
