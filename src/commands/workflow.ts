import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { WorkflowEngine } from '../core/workflow-engine.js';
import { resolveProjectRoot, getXSpecRoot, ensureInitialized, writeYAML } from '../utils.js';
import type { WorkflowDefinition } from '../types.js';

export const workflowCommand = new Command('workflow')
  .description('作业流标准化定义与管理');

// ─── create: 创建作业流 ───

workflowCommand
  .command('create <name>')
  .description('创建作业流定义')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('-d, --description <desc>', '作业流描述')
  .action(async (name: string, opts: any) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const engine = new WorkflowEngine(root);

    try {
      engine.createWorkflow(name, opts.description);
      console.log(chalk.green(`✓ 作业流 '${name}' 已创建`));
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });

// ─── compose: 从模板编排作业流（人工编排入口） ───

workflowCommand
  .command('compose [name]')
  .description('从流程模板编排自定义作业流')
  .option('-p, --path <path>', '项目根路径', '.')
  .option('-t, --template <template>', '基于哪个流程模板编排')
  .option('-d, --description <desc>', '作业流描述')
  .option('--interactive', '交互式编排')
  .action(async (name?: string, opts?: any) => {
    const root = resolveProjectRoot(opts?.path);
    ensureInitialized(root);
    const engine = new WorkflowEngine(root);
    const templates = engine.listWorkflowTemplates();

    if (templates.length === 0) {
      console.error(chalk.red('暂无可用流程模板，请先执行 x-spec init'));
      process.exit(1);
    }

    // 选择模板
    let templateName = opts?.template;
    if (!templateName) {
      console.log(chalk.cyan('\n可用流程模板:\n'));
      for (const t of templates) {
        console.log(`  ${chalk.yellow(t.name.padEnd(20))} ${t.description}`);
        console.log(`  ${''.padEnd(20)} ${t.stages.length} 个阶段, v${t.version}`);
      }
      console.log();

      if (opts?.interactive || !name) {
        const answer = await inquirer.prompt([{
          type: 'list',
          name: 'template',
          message: '选择流程模板:',
          choices: templates.map(t => ({
            name: `${t.name} - ${t.description}`,
            value: t.name,
          })),
        }]);
        templateName = answer.template;
      } else {
        templateName = 'sdd-standard';
      }
    }

    const template = engine.loadWorkflowTemplate(templateName);
    if (!template) {
      console.error(chalk.red(`模板不存在: ${templateName}`));
      process.exit(1);
    }

    // 确定作业流名称
    let workflowName = name;
    if (!workflowName) {
      const answer = await inquirer.prompt([{
        type: 'input',
        name: 'name',
        message: '作业流名称:',
        default: `${templateName}-custom`,
      }]);
      workflowName = answer.name;
    }

    // 交互式编排：让用户选择/调整阶段
    let selectedStages = template.stages;
    if (opts?.interactive) {
      console.log(chalk.cyan(`\n模板: ${template.name} - ${template.description}\n`));
      console.log('阶段列表:');

      const stageChoices = template.stages.map((s, i) => ({
        name: `${i + 1}. ${s.name} (${s.description}) ${s.required ? '[必需]' : '[可选]'}`,
        value: s.name,
        checked: s.required,
      }));

      const answer = await inquirer.prompt([{
        type: 'checkbox',
        name: 'stages',
        message: '选择要包含的阶段（必需阶段已预选）:',
        choices: stageChoices,
        validate: (input: string[]) => {
          const requiredStages = template.stages.filter(s => s.required).map(s => s.name);
          const missing = requiredStages.filter(r => !input.includes(r));
          if (missing.length > 0) return `必需阶段未选: ${missing.join(', ')}`;
          return true;
        },
      }]);

      selectedStages = template.stages.filter(s => answer.stages.includes(s.name));
    }

    // 生成作业流定义
    const description = opts?.description || `基于模板 ${templateName} 编排的作业流`;

    try {
      engine.createWorkflowFromTemplate(templateName, workflowName, {
        description,
        hooks: [],
      });

      // 如果交互式编排修改了阶段，覆盖生成的workflow文件
      if (opts?.interactive && selectedStages.length !== template.stages.length) {
        const xspecRoot = getXSpecRoot(root);
        const workflowPath = path.join(xspecRoot, 'workflows', `${workflowName}.yml`);
        const wf = YAML.parse(fs.readFileSync(workflowPath, 'utf-8')) as WorkflowDefinition;
        wf.steps = selectedStages.map(stage => ({
          name: stage.name,
          description: stage.description,
          action: stage.command,
          required: stage.required,
          depends_on: stage.depends_on.filter(d => selectedStages.some(s => s.name === d)),
        }));
        writeYAML(workflowPath, wf);
      }

      console.log(chalk.green(`\n✓ 作业流 '${workflowName}' 已从模板 '${templateName}' 创建`));
      console.log(chalk.gray(`  路径: x-spec/workflows/${workflowName}.yml`));
      console.log(chalk.gray(`  阶段: ${selectedStages.length} 个`));
      console.log(chalk.gray('\n可手动编辑 YAML 文件调整阶段和参数'));
      console.log(chalk.cyan(`  执行: x-spec workflow run ${workflowName}\n`));
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });

// ─── list: 列出作业流 ───

workflowCommand
  .command('list')
  .description('列出所有作业流')
  .option('-p, --path <path>', '项目根路径', '.')
  .action(async (opts: any) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const engine = new WorkflowEngine(root);
    const workflows = engine.listWorkflows();

    if (workflows.length === 0) {
      console.log(chalk.gray('暂无作业流定义'));
      return;
    }

    console.log(chalk.cyan('作业流列表:'));
    for (const wf of workflows) {
      console.log(`  ${(wf.name || '').padEnd(30)} ${wf.description || ''}`);
    }
  });

// ─── templates: 列出流程模板 ───

workflowCommand
  .command('templates')
  .description('列出可用流程模板')
  .option('-p, --path <path>', '项目根路径', '.')
  .action(async (opts: any) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const engine = new WorkflowEngine(root);
    const templates = engine.listWorkflowTemplates();

    if (templates.length === 0) {
      console.log(chalk.gray('暂无可用流程模板'));
      return;
    }

    console.log(chalk.cyan('\n流程模板列表:\n'));
    for (const t of templates) {
      console.log(`  ${chalk.yellow(t.name.padEnd(20))} ${t.description}`);
      console.log(`  ${''.padEnd(20)} v${t.version} | ${t.stages.length} 个阶段`);
      for (const s of t.stages) {
        const icon = s.required ? '●' : '○';
        const deps = s.depends_on.length > 0 ? ` ← ${s.depends_on.join(', ')}` : '';
        console.log(`    ${icon} ${s.name}${deps}`);
      }
      console.log();
    }
  });

// ─── validate: 验证作业流 ───

workflowCommand
  .command('validate <name>')
  .description('验证作业流定义')
  .option('-p, --path <path>', '项目根路径', '.')
  .action(async (name: string, opts: any) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const engine = new WorkflowEngine(root);
    const result = engine.validateWorkflow(name);

    if (result.valid) {
      console.log(chalk.green(`✓ 作业流 '${name}' 验证通过`));
    } else {
      console.log(chalk.red('✗ 验证失败:'));
      result.errors.forEach(e => console.log(chalk.red(`  - ${e}`)));
      process.exit(1);
    }
  });

// ─── run: 执行作业流 ───

workflowCommand
  .command('run <name>')
  .description('执行作业流')
  .option('-p, --path <path>', '项目根路径', '.')
  .action(async (name: string, opts: any) => {
    const root = resolveProjectRoot(opts.path);
    ensureInitialized(root);
    const engine = new WorkflowEngine(root);

    try {
      engine.runWorkflow(name);
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });
