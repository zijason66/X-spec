/**
 * SuperPowers执行引擎 - 斜杠命令系统与工件生成
 *
 * 集成SDD工作流的斜杠命令，对应OpenSpec的命令体系
 */

import type { CommandResult, ChangeProposal, ArtifactBundle, Artifact } from '../types.js';
import { SpecEngine } from './spec-engine.js';

type CommandExecutor = (params: Record<string, string>) => CommandResult;

interface SlashCommand {
  name: string;
  description: string;
  executor: CommandExecutor;
}

export class SlashCommandEngine {
  private readonly commands = new Map<string, SlashCommand>();
  private readonly specEngine: SpecEngine;

  constructor(projectRoot: string) {
    this.specEngine = new SpecEngine(projectRoot);
    this.registerCommands();
  }

  /** 执行斜杠命令 */
  execute(commandName: string, params: Record<string, string> = {}): CommandResult {
    const command = this.commands.get(commandName);
    if (!command) return { success: false, message: `未知命令: ${commandName}`, data: {} };

    try {
      return command.executor(params);
    } catch (e: any) {
      return { success: false, message: `命令执行失败: ${e.message}`, data: {} };
    }
  }

  /** 列出所有可用命令 */
  listCommands(): { name: string; description: string }[] {
    return [...this.commands.values()].map(c => ({ name: c.name, description: c.description }));
  }

  // ─── 命令注册 ───

  private registerCommands(): void {
    this.commands.set('propose', {
      name: 'propose',
      description: '发起变更提案，生成OpenSpec结构化变更文档包',
      executor: (params) => {
        const desc = params.description;
        if (!desc) return { success: false, message: '缺少变更描述参数: description', data: {} };
        const proposal = this.specEngine.createProposal(desc, params.name);
        return { success: true, message: `变更提案已生成: ${proposal.name}`, data: { proposalName: proposal.name } };
      },
    });

    this.commands.set('apply', {
      name: 'apply',
      description: '按tasks.md逐项执行变更任务',
      executor: (params) => {
        const changeName = params.change || this.specEngine.findActiveChange();
        if (!changeName) return { success: false, message: '未指定变更名称且无活动变更', data: {} };
        this.specEngine.applyChange(changeName);
        return { success: true, message: `变更任务执行完成: ${changeName}`, data: {} };
      },
    });

    this.commands.set('archive', {
      name: 'archive',
      description: '归档已完成的变更提案，合并规范增量',
      executor: (params) => {
        const changeName = params.change;
        if (!changeName) return { success: false, message: '未指定变更名称', data: {} };
        this.specEngine.archiveChange(changeName);
        return { success: true, message: `变更已归档: ${changeName}`, data: {} };
      },
    });

    this.commands.set('verify', {
      name: 'verify',
      description: '验证实现与规范一致性',
      executor: (params) => {
        const result = this.specEngine.verify(params.change, params.strict === 'true');
        if (result.consistent) {
          return { success: true, message: '实现与规范保持一致', data: {} };
        }
        return { success: false, message: `发现规范偏差，共 ${result.deviations.length} 项`, data: {} };
      },
    });

    this.commands.set('new', {
      name: 'new',
      description: '新建变更（扩展模式，先检查是否有未完成变更）',
      executor: (params) => {
        const active = this.specEngine.findActiveChange();
        if (active) return { success: false, message: `存在未完成的变更: ${active}`, data: {} };
        return this.commands.get('propose')!.executor(params);
      },
    });

    this.commands.set('continue', {
      name: 'continue',
      description: '继续进行中的变更（扩展模式）',
      executor: (_params) => {
        const active = this.specEngine.findActiveChange();
        if (!active) return { success: false, message: '没有进行中的变更', data: {} };
        return this.commands.get('apply')!.executor({ change: active });
      },
    });

    this.commands.set('ff', {
      name: 'ff',
      description: '快速推进变更（扩展模式，跳过部分评审）',
      executor: (params) => {
        const proposeResult = this.commands.get('propose')!.executor(params);
        if (!proposeResult.success) return proposeResult;
        const changeName = proposeResult.data.proposalName as string;
        return this.commands.get('apply')!.executor({ change: changeName });
      },
    });

    this.commands.set('onboard', {
      name: 'onboard',
      description: '项目上手 - 为现有代码库生成初始规范',
      executor: (_params) => {
        const proposal = this.specEngine.createProposal('项目上手 - 为现有代码库生成初始规范', 'onboard');
        return { success: true, message: `上手规范已生成: ${proposal.name}`, data: { proposalName: proposal.name } };
      },
    });
  }
}

/**
 * 工件生成器 - 生成变更提案的全部工件
 */
export class ArtifactGenerator {
  generateChangeArtifacts(proposal: ChangeProposal): ArtifactBundle {
    const bundle: ArtifactBundle = { proposalName: proposal.name, artifacts: [] };

    bundle.artifacts.push({
      name: 'proposal',
      type: 'MARKDOWN',
      content: `# Proposal: ${proposal.name}\n\n## 变更描述\n${proposal.description}\n`,
    });

    bundle.artifacts.push({
      name: 'design',
      type: 'MARKDOWN',
      content: `# Design: ${proposal.name}\n\n## 技术方案\n\n## 设计决策\n1.\n`,
    });

    bundle.artifacts.push({
      name: 'tasks',
      type: 'MARKDOWN',
      content: `# Tasks: ${proposal.name}\n\n- [ ] T1: 分析需求并确定代码变更范围\n- [ ] T2: 实现核心逻辑变更\n`,
    });

    for (const delta of proposal.specDeltas) {
      bundle.artifacts.push({
        name: `spec-delta-${delta.specName}`,
        type: 'SPEC_DELTA',
        content: `Spec Delta: ${delta.specName} [${delta.type}]`,
      });
    }

    return bundle;
  }
}
