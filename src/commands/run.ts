import { Command } from 'commander';
import chalk from 'chalk';
import { WorkflowEngine } from '../core/workflow-engine.js';
import { resolveProjectRoot, ensureInitialized, loadConfig } from '../utils.js';

export const runCommand = new Command('run')
  .description('按默认SDD流程串接执行（知识注入→提案→审查→实现→验证→归档）')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('-t, --template <template>', '流程模板名称', 'sdd-standard')
  .option('-d, --description <desc>', '变更描述（propose阶段使用）')
  .option('-n, --name <name>', '变更名称')
  .option('--from <stage>', '从指定阶段开始执行')
  .option('--dry-run', '仅展示执行计划，不实际执行')
  .action(async (opts) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const engine = new WorkflowEngine(root);
    const config = loadConfig(root);
    const templateName = opts.template || config?.sdd?.['default-pipeline'] || 'sdd-standard';

    // 验证模板存在
    const template = engine.loadWorkflowTemplate(templateName);
    if (!template) {
      console.error(chalk.red(`流程模板不存在: ${templateName}`));
      console.log(chalk.gray('\n可用模板:'));
      const templates = engine.listWorkflowTemplates();
      if (templates.length === 0) {
        console.log(chalk.gray('  (无) - 请先执行 x-spec init'));
      } else {
        for (const t of templates) {
          console.log(`  ${t.name.padEnd(20)} ${t.description}`);
        }
      }
      process.exit(1);
    }

    // dry-run 模式
    if (opts.dryRun) {
      console.log(chalk.cyan(`\n流程执行计划: ${template.description}`));
      console.log(chalk.gray(`模板: ${template.name} v${template.version}\n`));

      for (let i = 0; i < template.stages.length; i++) {
        const stage = template.stages[i];
        const icon = stage.required ? '●' : '○';
        const deps = stage.depends_on.length > 0 ? ` (依赖: ${stage.depends_on.join(', ')})` : '';
        console.log(`  ${icon} ${i + 1}. ${stage.name}: ${stage.description}${deps}`);
        if (stage.command) console.log(`     命令: x-spec ${stage.command}`);
        if (stage.output) console.log(`     输出: ${stage.output}`);
      }

      console.log(chalk.gray('\n(dry-run) 仅展示执行计划，未实际执行\n'));
      return;
    }

    // 如果指定了起始阶段
    if (opts.from) {
      const stageIndex = template.stages.findIndex(s => s.name === opts.from);
      if (stageIndex < 0) {
        console.error(chalk.red(`阶段不存在: ${opts.from}`));
        console.log(chalk.gray('可用阶段:'));
        template.stages.forEach((s, i) => console.log(`  ${i + 1}. ${s.name}`));
        process.exit(1);
      }
      console.log(chalk.yellow(`从阶段 '${opts.from}' 开始执行 (跳过前 ${stageIndex} 个阶段)\n`));
    }

    // 构建参数
    const params: Record<string, string> = {};
    if (opts.description) params.description = opts.description;
    if (opts.name) params.name = opts.name;

    // 执行流程
    try {
      const result = engine.runPipeline(templateName, params);

      if (result.status === 'SUCCESS') {
        console.log(chalk.green('\n✓ 流程执行完成'));
      } else if (result.status === 'FAILED') {
        console.log(chalk.red('\n✗ 流程执行失败'));
        const failedStages = result.stages.filter(s => s.status === 'FAILED');
        for (const s of failedStages) {
          console.log(chalk.red(`  - ${s.name}: ${s.message}`));
        }
        process.exit(1);
      }
    } catch (e: any) {
      console.error(chalk.red(`\n流程执行异常: ${e.message}`));
      process.exit(1);
    }
  });
