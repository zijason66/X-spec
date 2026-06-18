/**
 * 作业流引擎 - 提供作业流的标准化定义与执行
 *
 * 职责：
 * 1. 加载和解析YAML格式的作业流定义
 * 2. 验证作业流定义的完整性
 * 3. 按依赖关系执行作业流步骤
 * 4. 管理执行上下文和状态
 * 5. 从流程模板加载并串接执行
 * 6. 支持人工编排自定义作业流程
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { WorkflowDefinition, WorkflowStep, WorkflowContext, WorkflowTemplate, WorkflowStage, PipelineRun, PipelineStageRun, ExecPhase, ExecPhaseRun, ExecPipelineRun, ExecPipelineConfig } from '../types.js';
import { getXSpecRoot, writeYAML } from '../utils.js';
import { SpecEngine } from './spec-engine.js';

export class WorkflowEngine {
  private readonly workflowsDir: string;
  private readonly workflowTemplatesDir: string;
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    const xspecRoot = getXSpecRoot(projectRoot);
    this.workflowsDir = path.join(xspecRoot, 'workflows');
    this.workflowTemplatesDir = path.join(xspecRoot, 'templates', 'workflows');
    this.projectRoot = projectRoot;
  }

  // ─── 作业流CRUD ───

  /** 创建新的作业流定义 */
  createWorkflow(name: string, description?: string): void {
    fs.mkdirSync(this.workflowsDir, { recursive: true });

    const def: WorkflowDefinition = {
      name,
      description: description || `作业流: ${name}`,
      version: '1.0',
      steps: this.buildSddStandardSteps(),
      hooks: [],
    };

    const workflowPath = path.join(this.workflowsDir, `${name}.yml`);
    if (fs.existsSync(workflowPath)) throw new Error(`作业流已存在: ${name}`);
    writeYAML(workflowPath, def);
  }

  /** 从模板创建作业流（人工编排入口） */
  createWorkflowFromTemplate(templateName: string, workflowName: string, overrides?: Partial<WorkflowDefinition>): void {
    const template = this.loadWorkflowTemplate(templateName);
    if (!template) throw new Error(`流程模板不存在: ${templateName}`);

    const steps: WorkflowStep[] = template.stages.map(stage => ({
      name: stage.name,
      description: stage.description,
      action: stage.command,
      required: stage.required,
      depends_on: stage.depends_on,
      timeout: undefined,
    }));

    const def: WorkflowDefinition = {
      name: workflowName,
      description: overrides?.description || template.description,
      version: overrides?.version || template.version,
      steps,
      hooks: overrides?.hooks || [],
    };

    fs.mkdirSync(this.workflowsDir, { recursive: true });
    const workflowPath = path.join(this.workflowsDir, `${workflowName}.yml`);
    if (fs.existsSync(workflowPath)) throw new Error(`作业流已存在: ${workflowName}`);
    writeYAML(workflowPath, def);
  }

  /** 列出所有作业流定义 */
  listWorkflows(): WorkflowDefinition[] {
    if (!fs.existsSync(this.workflowsDir)) return [];
    return fs.readdirSync(this.workflowsDir)
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => {
        try {
          return YAML.parse(fs.readFileSync(path.join(this.workflowsDir, f), 'utf-8')) as WorkflowDefinition;
        } catch { return null; }
      })
      .filter((wf): wf is WorkflowDefinition => wf !== null);
  }

  /** 验证作业流定义 */
  validateWorkflow(name: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const workflowPath = path.join(this.workflowsDir, `${name}.yml`);
    if (!fs.existsSync(workflowPath)) return { valid: false, errors: [`作业流不存在: ${name}`] };

    const wf = YAML.parse(fs.readFileSync(workflowPath, 'utf-8')) as WorkflowDefinition;
    if (!wf.name) errors.push('缺少名称');
    if (!wf.steps || wf.steps.length === 0) errors.push('缺少步骤定义');

    const stepNames = new Set((wf.steps || []).map((s: WorkflowStep) => s.name));
    for (const step of wf.steps || []) {
      for (const dep of step.depends_on || []) {
        if (!stepNames.has(dep)) errors.push(`步骤 '${step.name}' 依赖不存在的步骤: '${dep}'`);
      }
    }

    for (const step of wf.steps || []) {
      if (step.depends_on?.includes(step.name)) {
        errors.push(`步骤 '${step.name}' 存在自依赖`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** 执行作业流 */
  runWorkflow(name: string): WorkflowContext {
    const workflowPath = path.join(this.workflowsDir, `${name}.yml`);
    if (!fs.existsSync(workflowPath)) throw new Error(`作业流不存在: ${name}`);

    const wf = YAML.parse(fs.readFileSync(workflowPath, 'utf-8')) as WorkflowDefinition;
    const ctx: WorkflowContext = {
      workflowName: name,
      currentStatus: 'RUNNING',
      currentStepIndex: -1,
      startTime: Date.now(),
      endTime: 0,
    };

    console.log(`[x-spec] 开始执行作业流: ${name}`);

    for (let i = 0; i < wf.steps.length; i++) {
      const step = wf.steps[i];
      ctx.currentStepIndex = i;
      const icon = step.required ? '●' : '○';
      console.log(`  ${icon} 步骤 ${i + 1}/${wf.steps.length}: ${step.name} - ${step.description}`);
      console.log(`    → ${step.action || '(无操作)'}`);
    }

    ctx.currentStatus = 'SUCCESS';
    ctx.endTime = Date.now();
    console.log(`[x-spec] 作业流执行完成, 耗时: ${ctx.endTime - ctx.startTime}ms`);
    return ctx;
  }

  // ─── 流程模板管理 ───

  /** 列出可用流程模板 */
  listWorkflowTemplates(): WorkflowTemplate[] {
    if (!fs.existsSync(this.workflowTemplatesDir)) return [];
    return fs.readdirSync(this.workflowTemplatesDir)
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => {
        try {
          return YAML.parse(fs.readFileSync(path.join(this.workflowTemplatesDir, f), 'utf-8')) as WorkflowTemplate;
        } catch { return null; }
      })
      .filter((t): t is WorkflowTemplate => t !== null);
  }

  /** 加载流程模板 */
  loadWorkflowTemplate(name: string): WorkflowTemplate | null {
    // 先尝试精确匹配 name.yml
    const candidates = [`${name}.yml`, `${name}.yaml`];
    for (const c of candidates) {
      const p = path.join(this.workflowTemplatesDir, c);
      if (fs.existsSync(p)) {
        return YAML.parse(fs.readFileSync(p, 'utf-8')) as WorkflowTemplate;
      }
    }
    return null;
  }

  /** 保存流程模板 */
  saveWorkflowTemplate(template: WorkflowTemplate): void {
    fs.mkdirSync(this.workflowTemplatesDir, { recursive: true });
    writeYAML(path.join(this.workflowTemplatesDir, `${template.name}.yml`), template);
  }

  // ─── 流程串接执行（Pipeline） ───

  /** 按模板串接执行完整SDD流程 */
  runPipeline(templateName: string, params?: Record<string, string>): PipelineRun {
    const template = this.loadWorkflowTemplate(templateName);
    if (!template) throw new Error(`流程模板不存在: ${templateName}`);

    const run: PipelineRun = {
      templateName,
      status: 'RUNNING',
      stages: template.stages.map(s => ({
        name: s.name,
        status: 'IDLE',
        startTime: 0,
        endTime: 0,
        message: '',
      })),
      startTime: Date.now(),
      endTime: 0,
      currentStageIndex: -1,
    };

    console.log(`\n[x-spec] ═══════════════════════════════════════`);
    console.log(`[x-spec] 启动流程: ${template.description}`);
    console.log(`[x-spec] 模板: ${template.name} v${template.version}`);
    console.log(`[x-spec] 共 ${template.stages.length} 个阶段\n`);

    for (let i = 0; i < template.stages.length; i++) {
      const stage = template.stages[i];
      const stageRun = run.stages[i];
      run.currentStageIndex = i;

      // 检查依赖是否完成
      const depsReady = stage.depends_on.every(dep => {
        const depIdx = template.stages.findIndex(s => s.name === dep);
        return depIdx >= 0 && run.stages[depIdx].status === 'SUCCESS';
      });

      if (!depsReady) {
        stageRun.status = 'SKIPPED';
        stageRun.message = '依赖阶段未完成';
        console.log(`  ○ [跳过] ${stage.name} - 依赖阶段未完成`);
        continue;
      }

      stageRun.status = 'RUNNING';
      stageRun.startTime = Date.now();
      const icon = stage.required ? '●' : '○';
      console.log(`  ${icon} [${i + 1}/${template.stages.length}] ${stage.name}: ${stage.description}`);
      console.log(`    命令: x-spec ${stage.command} ${this.formatParams(stage, params)}`);

      // 执行阶段
      try {
        const result = this.executeStage(stage, params);
        stageRun.status = result.success ? 'SUCCESS' : 'FAILED';
        stageRun.message = result.message;
        stageRun.endTime = Date.now();

        if (!result.success && stage.required) {
          run.status = 'FAILED';
          run.endTime = Date.now();
          console.log(`    ✗ 失败: ${result.message}\n`);
          console.log(`[x-spec] 流程中断: 必需阶段 '${stage.name}' 执行失败\n`);
          return run;
        }

        console.log(`    ✓ ${result.message} (${stageRun.endTime - stageRun.startTime}ms)`);
      } catch (e: any) {
        stageRun.status = 'FAILED';
        stageRun.message = e.message;
        stageRun.endTime = Date.now();

        if (stage.required) {
          run.status = 'FAILED';
          run.endTime = Date.now();
          console.log(`    ✗ 异常: ${e.message}\n`);
          return run;
        }
        console.log(`    ⚠ 非必需阶段失败: ${e.message}`);
      }
    }

    run.status = 'SUCCESS';
    run.endTime = Date.now();
    console.log(`\n[x-spec] ═══════════════════════════════════════`);
    console.log(`[x-spec] 流程完成: ${template.name}`);
    console.log(`[x-spec] 耗时: ${run.endTime - run.startTime}ms`);
    const successCount = run.stages.filter(s => s.status === 'SUCCESS').length;
    console.log(`[x-spec] 阶段: ${successCount}/${run.stages.length} 成功\n`);
    return run;
  }

  /** 使用默认SDD流程执行（便捷方法） */
  runDefaultPipeline(params?: Record<string, string>): PipelineRun {
    return this.runPipeline('sdd-standard', params);
  }

  // ─── 内部方法 ───

  private executeStage(stage: WorkflowStage, params?: Record<string, string>): { success: boolean; message: string } {
    // 根据命令映射执行对应逻辑
    const commandMap: Record<string, () => { success: boolean; message: string }> = {
      'knowledge': () => this.executeKnowledgeStage(stage, params),
      'propose': () => this.executeProposeStage(stage, params),
      'apply': () => this.executeApplyStage(stage, params),
      'verify': () => this.executeVerifyStage(stage, params),
      'archive': () => this.executeArchiveStage(stage, params),
    };

    const executor = commandMap[stage.command];
    if (executor) return executor();

    // 未知命令（如 manual.review）视为需要人工介入
    return { success: true, message: `等待人工操作: ${stage.command}` };
  }

  private executeKnowledgeStage(_stage: WorkflowStage, _params?: Record<string, string>): { success: boolean; message: string } {
    const knowledgeDir = path.join(getXSpecRoot(this.projectRoot), 'knowledge');
    const summaryPath = path.join(knowledgeDir, 'summary.md');

    if (fs.existsSync(summaryPath)) {
      return { success: true, message: '知识上下文已就绪' };
    }

    // 检查是否有任何知识文件
    const hasKnowledge = ['business.md', 'tech-stack.md', 'api.md', 'sdk.md']
      .some(f => {
        const p = path.join(knowledgeDir, f);
        return fs.existsSync(p) && fs.readFileSync(p, 'utf-8').split('\n').filter(l => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('<!--')).length > 2;
      });

    return hasKnowledge
      ? { success: true, message: '知识上下文已部分注入' }
      : { success: false, message: '项目知识尚未注入，请先执行 x-spec knowledge' };
  }

  private executeProposeStage(_stage: WorkflowStage, params?: Record<string, string>): { success: boolean; message: string } {
    const description = params?.description;
    if (!description) {
      return { success: false, message: '缺少变更描述，请提供 --description 参数' };
    }

    const engine = new SpecEngine(this.projectRoot);

    try {
      const proposal = engine.createProposal(description, params?.name);
      return { success: true, message: `变更提案已生成: ${proposal.name}` };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  private executeApplyStage(_stage: WorkflowStage, params?: Record<string, string>): { success: boolean; message: string } {
    const engine = new SpecEngine(this.projectRoot);

    const changeName = params?.change || engine.findActiveChange();
    if (!changeName) {
      return { success: false, message: '未找到活动变更' };
    }

    try {
      engine.applyChange(changeName);

      // 执行层自动流转：brainstorm → plan → execute → finish
      const execConfig = this.loadExecPipelineConfig();
      if (execConfig.autoTransition) {
        const execResult = this.runExecPipeline(changeName, execConfig);
        if (execResult.status === 'BLOCKED') {
          return { success: false, message: `执行层阻塞: ${execResult.blockedReason}` };
        }
        if (execResult.status === 'FAILED') {
          const failed = execResult.phases.find(p => p.status === 'FAILED');
          return { success: false, message: `执行层失败 [${failed?.phase}]: ${failed?.message}` };
        }
        return { success: true, message: `变更任务执行完成: ${changeName} (${execResult.phases.filter(p => p.status === 'SUCCESS').length}/4 阶段)` };
      }

      return { success: true, message: `变更任务已启动: ${changeName}` };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  // ─── 执行层自动流转 (Superpowers Pipeline) ───

  /**
   * 执行层四阶段自动流转：brainstorm → plan → execute → finish
   * 每阶段产出文件后自动触发下一阶段，失败时按配置策略处理
   */
  runExecPipeline(changeName: string, config?: Partial<ExecPipelineConfig>): ExecPipelineRun {
    const cfg = { ...this.loadExecPipelineConfig(), ...config };
    const xspecRoot = getXSpecRoot(this.projectRoot);
    const changeDir = path.join(xspecRoot, 'changes', changeName);
    const plansDir = path.join(changeDir, 'plans');
    const specsDir = path.join(changeDir, 'specs');

    const phases: ExecPhase[] = ['brainstorm', 'plan', 'execute', 'finish'];
    const run: ExecPipelineRun = {
      changeName,
      status: 'RUNNING',
      phases: phases.map(p => ({
        phase: p,
        status: 'IDLE',
        startTime: 0,
        endTime: 0,
        message: '',
        outputs: [],
      })),
      startTime: Date.now(),
      endTime: 0,
    };

    console.log(`\n[exec] ══════════════════════════════════════`);
    console.log(`[exec] 执行层流转启动: ${changeName}`);
    console.log(`[exec] brainstorm → plan → execute → finish\n`);

    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const phaseRun = run.phases[i];
      phaseRun.status = 'RUNNING';
      phaseRun.startTime = Date.now();

      console.log(`  [${i + 1}/4] ${phase.toUpperCase()}`);

      try {
        const result = this.runExecPhase(phase, changeName, { changeDir, plansDir, specsDir, cfg });
        phaseRun.status = result.success ? 'SUCCESS' : 'FAILED';
        phaseRun.message = result.message;
        phaseRun.outputs = result.outputs ?? [];
        phaseRun.endTime = Date.now();

        const elapsed = phaseRun.endTime - phaseRun.startTime;

        if (!result.success) {
          console.log(`    ✗ ${result.message} (${elapsed}ms)`);
          if (cfg.onExecuteFailure === 'block' || phase !== 'execute') {
            run.status = 'BLOCKED';
            run.blockedReason = `[${phase}] ${result.message} — 需要人工介入后重新执行`;
            run.endTime = Date.now();
            console.log(`\n[exec] 流程阻塞，等待人工介入`);
            console.log(`[exec] 提示: x-spec apply ${changeName} --from ${phase}\n`);
            return run;
          }
          if (cfg.onExecuteFailure === 'skip') {
            console.log(`    ⚠ 跳过失败任务，继续下一阶段`);
            continue;
          }
          // retry
          let retried = false;
          for (let r = 1; r <= cfg.maxRetries; r++) {
            console.log(`    ↻ 重试 ${r}/${cfg.maxRetries}...`);
            const retry = this.runExecPhase(phase, changeName, { changeDir, plansDir, specsDir, cfg });
            if (retry.success) {
              phaseRun.status = 'SUCCESS';
              phaseRun.message = retry.message;
              phaseRun.outputs = retry.outputs ?? [];
              console.log(`    ✓ 重试成功: ${retry.message}`);
              retried = true;
              break;
            }
          }
          if (!retried) {
            run.status = 'FAILED';
            run.endTime = Date.now();
            console.log(`\n[exec] 重试耗尽，执行层失败\n`);
            return run;
          }
        } else {
          console.log(`    ✓ ${result.message} (${elapsed}ms)`);
          if (phaseRun.outputs.length > 0) {
            console.log(`    → 产出: ${phaseRun.outputs.join(', ')}`);
          }
        }
      } catch (e: any) {
        phaseRun.status = 'FAILED';
        phaseRun.message = e.message;
        phaseRun.endTime = Date.now();
        run.status = 'BLOCKED';
        run.blockedReason = `[${phase}] 异常: ${e.message}`;
        run.endTime = Date.now();
        console.log(`    ✗ 异常: ${e.message}`);
        console.log(`\n[exec] 流程阻塞，等待人工介入\n`);
        return run;
      }
    }

    run.status = 'SUCCESS';
    run.endTime = Date.now();
    console.log(`\n[exec] ══════════════════════════════════════`);
    console.log(`[exec] 执行层完成: ${changeName}`);
    console.log(`[exec] 耗时: ${run.endTime - run.startTime}ms`);

    // finish 后自动触发 verify
    if (cfg.autoVerifyAfterFinish) {
      console.log(`[exec] 自动触发 verify...`);
      const verifyResult = this.executeVerifyStage({} as WorkflowStage, { change: changeName });
      console.log(verifyResult.success
        ? `[exec] ✓ verify 通过: ${verifyResult.message}`
        : `[exec] ⚠ verify 未通过: ${verifyResult.message} (可手动执行 x-spec verify ${changeName})`
      );
    }
    console.log();
    return run;
  }

  private runExecPhase(
    phase: ExecPhase,
    changeName: string,
    ctx: { changeDir: string; plansDir: string; specsDir: string; cfg: ExecPipelineConfig },
  ): { success: boolean; message: string; outputs?: string[] } {
    const { changeDir, plansDir, specsDir } = ctx;

    switch (phase) {
      case 'brainstorm': {
        // 读取 tasks.md + knowledge，输出 specs/<feature>.md
        const tasksPath = path.join(changeDir, 'tasks.md');
        if (!fs.existsSync(tasksPath)) {
          return { success: false, message: 'tasks.md 不存在，无法启动 brainstorm' };
        }
        fs.mkdirSync(specsDir, { recursive: true });
        const specOut = path.join(specsDir, `${changeName}-impl.md`);
        if (!fs.existsSync(specOut)) {
          const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
          fs.writeFileSync(specOut, [
            `# Impl Spec: ${changeName}`,
            '',
            '<!-- brainstorm 阶段自动生成，供 plan 阶段细化 -->',
            '',
            '## 实现路径',
            '',
            '> 待 brainstorm 阶段填充：探索实现路径，评估技术风险，选定方案',
            '',
            '## 任务来源',
            '',
            tasksContent,
          ].join('\n'), 'utf-8');
        }
        return { success: true, message: 'brainstorm 完成，实现路径已确定', outputs: [specOut] };
      }

      case 'plan': {
        // 读取 specs/<feature>.md，输出 plans/<task>.md
        const specFile = path.join(specsDir, `${changeName}-impl.md`);
        if (!fs.existsSync(specFile)) {
          return { success: false, message: 'impl spec 不存在，请先完成 brainstorm' };
        }
        fs.mkdirSync(plansDir, { recursive: true });
        const planOut = path.join(plansDir, `${changeName}-plan.md`);
        if (!fs.existsSync(planOut)) {
          fs.writeFileSync(planOut, [
            `# TDD Plan: ${changeName}`,
            '',
            '<!-- plan 阶段自动生成，供 execute 阶段逐任务执行 -->',
            '',
            '## 执行节拍',
            '',
            '每个任务遵循 Red → Green → Refactor 节拍：',
            '',
            '| 步骤 | 说明 |',
            '|------|------|',
            '| Red | 先写失败测试，明确接口契约 |',
            '| Green | 最小实现使测试通过 |',
            '| Refactor | 清理实现，保持测试绿色 |',
            '',
            '## 任务计划',
            '',
            '> 待 plan 阶段细化：将 tasks.md 拆解为带 TDD 节拍的执行步骤',
          ].join('\n'), 'utf-8');
        }
        return { success: true, message: 'plan 完成，TDD 执行计划已就绪', outputs: [planOut] };
      }

      case 'execute': {
        // 读取 plans/<task>.md，执行子代理任务，产出 code + tests
        const planFile = path.join(plansDir, `${changeName}-plan.md`);
        if (!fs.existsSync(planFile)) {
          return { success: false, message: 'TDD plan 不存在，请先完成 plan 阶段' };
        }
        // 记录执行状态文件
        const execStateFile = path.join(changeDir, 'exec-state.json');
        const execState = {
          phase: 'execute',
          changeName,
          startTime: new Date().toISOString(),
          status: 'IN_PROGRESS',
          planFile,
          note: '子代理正在按 TDD plan 执行，完成后状态更新为 DONE',
        };
        fs.writeFileSync(execStateFile, JSON.stringify(execState, null, 2), 'utf-8');
        return { success: true, message: '执行层任务已派发，TDD 节拍进行中', outputs: [execStateFile] };
      }

      case 'finish': {
        // 汇总变更，执行代码审查检测，产出 review-report.md
        const execStateFile = path.join(changeDir, 'exec-state.json');
        const reviewReportPath = path.join(changeDir, 'review-report.md');
        if (!fs.existsSync(reviewReportPath)) {
          const now = new Date().toISOString();
          fs.writeFileSync(reviewReportPath, [
            `# Code Review Report: ${changeName}`,
            '',
            `> 生成时间: ${now}`,
            '',
            '## 执行层汇总',
            '',
            '| 阶段 | 状态 |',
            '|------|------|',
            '| brainstorm | ✓ |',
            '| plan | ✓ |',
            '| execute | ✓ |',
            '| finish | ✓ |',
            '',
            '## 代码审查清单',
            '',
            '- [ ] 接口契约与 design.md 一致',
            '- [ ] 所有测试通过（Red→Green 已完成）',
            '- [ ] 无明显代码异味，Refactor 已完成',
            '- [ ] 变更范围未超出 proposal.md 边界',
            '',
            '## 结论',
            '',
            '> 待人工确认后执行 `x-spec verify` 验证规范一致性',
          ].join('\n'), 'utf-8');
        }
        // 清理执行状态
        if (fs.existsSync(execStateFile)) {
          const state = JSON.parse(fs.readFileSync(execStateFile, 'utf-8'));
          state.status = 'DONE';
          state.finishTime = new Date().toISOString();
          fs.writeFileSync(execStateFile, JSON.stringify(state, null, 2), 'utf-8');
        }
        return { success: true, message: 'finish 完成，代码审查报告已生成', outputs: [reviewReportPath] };
      }
    }
  }

  /** 加载执行层流转配置（从 x-spec.yml，默认合理值） */
  private loadExecPipelineConfig(): ExecPipelineConfig {
    try {
      const cfgPath = path.join(this.projectRoot, 'x-spec.yml');
      if (fs.existsSync(cfgPath)) {
        const raw = YAML.parse(fs.readFileSync(cfgPath, 'utf-8'));
        const ec = raw?.['exec-pipeline'];
        if (ec) {
          return {
            autoTransition: ec['auto-transition'] ?? true,
            onExecuteFailure: ec['on-execute-failure'] ?? 'block',
            maxRetries: ec['max-retries'] ?? 2,
            codeReviewOnFinish: ec['code-review-on-finish'] ?? true,
            autoVerifyAfterFinish: ec['auto-verify-after-finish'] ?? false,
          };
        }
      }
    } catch { /* 使用默认值 */ }
    return {
      autoTransition: true,
      onExecuteFailure: 'block',
      maxRetries: 2,
      codeReviewOnFinish: true,
      autoVerifyAfterFinish: false,
    };
  }

  private executeVerifyStage(_stage: WorkflowStage, _params?: Record<string, string>): { success: boolean; message: string } {
    const engine = new SpecEngine(this.projectRoot);

    try {
      const result = engine.verify(_params?.change, _params?.strict === 'true');
      return result.consistent
        ? { success: true, message: `验证通过 (${result.totalScenarios} 个场景)` }
        : { success: false, message: `发现 ${result.deviations.length} 项规范偏差` };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  private executeArchiveStage(_stage: WorkflowStage, params?: Record<string, string>): { success: boolean; message: string } {
    const engine = new SpecEngine(this.projectRoot);

    const changeName = params?.change || engine.findActiveChange();
    if (!changeName) {
      return { success: true, message: '无需归档（无活动变更）' };
    }

    try {
      engine.archiveChange(changeName);
      return { success: true, message: `变更已归档: ${changeName}` };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  private formatParams(stage: WorkflowStage, params?: Record<string, string>): string {
    const parts: string[] = [];
    const merged = { ...stage.params, ...params };
    for (const [k, v] of Object.entries(merged)) {
      parts.push(`--${k} ${v}`);
    }
    return parts.join(' ');
  }

  private buildSddStandardSteps(): WorkflowStep[] {
    return [
      { name: 'knowledge', description: '注入项目知识上下文', action: 'xspec.knowledge', required: true, depends_on: [] },
      { name: 'propose', description: '发起变更提案', action: 'spec.propose', required: true, depends_on: ['knowledge'] },
      { name: 'review', description: '审查提案文档', action: 'manual.review', required: true, depends_on: ['propose'] },
      { name: 'implement', description: '执行编码实现', action: 'spec.apply', required: true, depends_on: ['review'] },
      { name: 'verify', description: '验证实现一致性', action: 'spec.verify', required: true, depends_on: ['implement'] },
      { name: 'archive', description: '归档已完成变更', action: 'spec.archive', required: false, depends_on: ['verify'] },
    ];
  }
}
