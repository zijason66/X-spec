/**
 * OpenSpec规范引擎 - SDD核心驱动引擎
 *
 * 职责：
 * 1. 管理规范文件（specs）的加载、解析和持久化
 * 2. 创建变更提案（changes）并生成结构化工件包
 * 3. 执行变更任务（apply）并跟踪完成状态
 * 4. 归档变更（archive）并合并规范增量
 * 5. 验证实现与规范一致性（verify）
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ChangeProposal, SpecDelta, VerificationResult, Deviation, KnowledgeContext } from '../types.js';
import { getXSpecRoot } from '../utils.js';

export class SpecEngine {
  private readonly xspecRoot: string;
  private readonly specsDir: string;
  private readonly changesDir: string;
  private readonly archiveDir: string;

  constructor(projectRoot: string) {
    this.xspecRoot = getXSpecRoot(projectRoot);
    this.specsDir = path.join(this.xspecRoot, 'specs');
    this.changesDir = path.join(this.xspecRoot, 'changes');
    this.archiveDir = path.join(this.xspecRoot, 'archive');
  }

  /** 创建变更提案 - SDD工作流核心入口 */
  createProposal(description: string, changeName?: string, knowledgeCtx?: KnowledgeContext): ChangeProposal {
    const name = changeName || this.generateChangeName(description);
    const changeDir = path.join(this.changesDir, name);

    if (fs.existsSync(changeDir)) {
      throw new Error(`变更提案已存在: ${name}`);
    }

    fs.mkdirSync(changeDir, { recursive: true });
    fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true });

    // 生成四种核心工件
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), this.buildProposalMd(name, description, knowledgeCtx));
    fs.writeFileSync(path.join(changeDir, 'design.md'), this.buildDesignMd(name, description, knowledgeCtx));
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), this.buildTasksMd(name));
    if (knowledgeCtx) {
      fs.writeFileSync(path.join(changeDir, 'knowledge-ref.md'), this.buildKnowledgeRefMd(knowledgeCtx));
    }

    return { name, description, status: 'PROPOSED', specDeltas: [] };
  }

  /** 执行变更任务 */
  applyChange(changeName: string, dryRun = false): void {
    const changeDir = path.join(this.changesDir, changeName);
    if (!fs.existsSync(changeDir)) throw new Error(`变更提案不存在: ${changeName}`);

    const tasksFile = path.join(changeDir, 'tasks.md');
    if (!fs.existsSync(tasksFile)) throw new Error('任务清单不存在');

    const tasks = fs.readFileSync(tasksFile, 'utf-8');
    const taskLines = tasks.split('\n');
    let idx = 0;

    console.log('[x-spec] 任务清单:');
    for (const line of taskLines) {
      const match = line.match(/^-\s+\[([ x~!])\]\s+(.+)/);
      if (match) {
        idx++;
        const s = match[1];
        const status = { x: 'COMPLETED', '~': 'IN_PROGRESS', '!': 'FAILED', ' ': 'PENDING' }[s] || 'PENDING';
        console.log(`  ${idx}. [${status}] ${match[2]}`);
      }
    }

    if (dryRun) {
      console.log('[x-spec] (dry-run) 仅展示执行计划');
      return;
    }

    fs.writeFileSync(path.join(changeDir, '.status'), 'APPLYING');
    console.log('[x-spec] 开始执行任务...');
  }

  /** 归档变更 */
  archiveChange(changeName: string): void {
    const changeDir = path.join(this.changesDir, changeName);
    if (!fs.existsSync(changeDir)) throw new Error(`变更提案不存在: ${changeName}`);

    const archiveTarget = path.join(this.archiveDir, changeName);
    this.copyDirRecursive(changeDir, archiveTarget);

    // 合并规范增量
    const specsDeltaDir = path.join(changeDir, 'specs');
    if (fs.existsSync(specsDeltaDir)) {
      for (const deltaDir of fs.readdirSync(specsDeltaDir)) {
        const deltaSpec = path.join(specsDeltaDir, deltaDir, 'spec.md');
        const targetSpec = path.join(this.specsDir, deltaDir, 'spec.md');
        if (fs.existsSync(deltaSpec)) {
          fs.mkdirSync(path.dirname(targetSpec), { recursive: true });
          fs.copyFileSync(deltaSpec, targetSpec);
        }
      }
    }

    fs.rmSync(changeDir, { recursive: true, force: true });
  }

  /** 查找活动变更 */
  findActiveChange(): string | null {
    if (!fs.existsSync(this.changesDir)) return null;
    const dirs = fs.readdirSync(this.changesDir).filter(f =>
      fs.statSync(path.join(this.changesDir, f)).isDirectory()
    );
    return dirs[0] || null;
  }

  /** 验证实现与规范一致性 */
  verify(changeName?: string, strict = false): VerificationResult {
    const result: VerificationResult = { consistent: true, deviations: [], totalScenarios: 0, matchedScenarios: 0 };

    if (fs.existsSync(this.specsDir)) {
      for (const specDir of fs.readdirSync(this.specsDir)) {
        const specFile = path.join(this.specsDir, specDir, 'spec.md');
        if (fs.existsSync(specFile)) {
          this.verifySpec(specFile, result, strict);
        }
      }
    }

    if (changeName) {
      const changeSpecsDir = path.join(this.changesDir, changeName, 'specs');
      if (fs.existsSync(changeSpecsDir)) {
        for (const deltaDir of fs.readdirSync(changeSpecsDir)) {
          const specFile = path.join(changeSpecsDir, deltaDir, 'spec.md');
          if (fs.existsSync(specFile)) {
            this.verifySpec(specFile, result, strict);
          }
        }
      }
    }

    if (result.deviations.length > 0) result.consistent = false;
    return result;
  }

  // ─── 内部方法 ───

  private verifySpec(specFile: string, result: VerificationResult, strict: boolean): void {
    const content = fs.readFileSync(specFile, 'utf-8');
    const scenarioCount = (content.match(/#### Scenario:/g) || []).length;
    const requirementCount = (content.match(/### Requirement:/g) || []).length;

    result.totalScenarios += scenarioCount;

    if (requirementCount > scenarioCount) {
      result.deviations.push({
        severity: 'WARNING',
        message: `${specFile}: 存在需求缺少对应的场景定义 (${requirementCount} requirements, ${scenarioCount} scenarios)`,
        suggestion: '为每个Requirement添加至少一个Given-When-Then场景',
      });
    }

    const scenarioBlocks = content.split('#### Scenario:');
    for (let i = 1; i < scenarioBlocks.length; i++) {
      const block = scenarioBlocks[i];
      const name = block.split('\n')[0]?.trim() || `Scenario ${i}`;
      if (!block.includes('- GIVEN')) {
        result.deviations.push({ severity: strict ? 'ERROR' : 'WARNING', message: `场景缺少 GIVEN: ${name}` });
      }
      if (!block.includes('- WHEN')) {
        result.deviations.push({ severity: strict ? 'ERROR' : 'WARNING', message: `场景缺少 WHEN: ${name}` });
      }
      if (!block.includes('- THEN')) {
        result.deviations.push({ severity: strict ? 'ERROR' : 'WARNING', message: `场景缺少 THEN: ${name}` });
      }
      result.matchedScenarios++;
    }
  }

  private generateChangeName(description: string): string {
    const name = description.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-').substring(0, 50);
    return name || `change-${Date.now()}`;
  }

  private buildProposalMd(name: string, desc: string, ctx?: KnowledgeContext): string {
    const knowledgeSection = ctx && (ctx.business || ctx.techStack || ctx.api || ctx.sdk)
      ? `## 项目知识上下文\n\n${ctx.business ? '### 业务背景\n> 详见 knowledge-ref.md\n\n' : ''}${ctx.techStack ? '### 技术栈约束\n> 详见 knowledge-ref.md\n\n' : ''}${ctx.api ? '### 外部API依赖\n> 详见 knowledge-ref.md\n\n' : ''}${ctx.sdk ? '### SDK依赖\n> 详见 knowledge-ref.md\n\n' : ''}`
      : '> ⚠ 未注入项目知识，建议执行 x-spec knowledge\n';

    return `# Proposal: ${name}

## 变更描述
${desc}

## 动机
<!-- 描述为什么要做这个变更 -->

## 影响范围
<!-- 列出受影响的模块和规范 -->

${knowledgeSection}
---
*由 x-spec 自动生成 · ${new Date().toISOString()}*
`;
  }

  private buildDesignMd(name: string, _desc: string, ctx?: KnowledgeContext): string {
    const techConstraint = ctx?.techStack ? `## 技术栈约束（基于已注入知识）\n> 参见 knowledge-ref.md 中的技术栈详情\n\n` : '';
    const apiConstraint = ctx?.api ? `## 外部API约束（基于已注入知识）\n> 参见 knowledge-ref.md 中的API依赖详情\n\n` : '';

    return `# Design: ${name}

## 技术方案
<!-- 描述实现的技术方案 -->

${techConstraint}${apiConstraint}## 设计决策
<!-- 列出关键的设计决策及理由 -->
1.

## 替代方案
1.

## 风险与缓解
1.

---
*由 x-spec 自动生成 · ${new Date().toISOString()}*
`;
  }

  private buildTasksMd(name: string): string {
    return `# Tasks: ${name}

## 实现任务清单

- [ ] T1: 分析需求并确定代码变更范围
- [ ] T2: 实现核心逻辑变更
- [ ] T3: 添加/更新单元测试
- [ ] T4: 更新相关文档
- [ ] T5: 验证实现与规范一致性

---
*由 x-spec 自动生成 · ${new Date().toISOString()}*
`;
  }

  private buildKnowledgeRefMd(ctx: KnowledgeContext): string {
    let content = `# 知识上下文引用\n\n> 本文件汇总项目已注入的知识上下文，供变更提案和设计参考。\n\n`;
    if (ctx.business) content += `---\n\n## 业务背景\n\n${ctx.business}\n\n`;
    if (ctx.techStack) content += `---\n\n## 技术栈\n\n${ctx.techStack}\n\n`;
    if (ctx.api) content += `---\n\n## 外部API依赖\n\n${ctx.api}\n\n`;
    if (ctx.sdk) content += `---\n\n## SDK依赖\n\n${ctx.sdk}\n\n`;
    // MCP 外部知识源
    if (ctx.external) {
      for (const [fileName, fileContent] of Object.entries(ctx.external)) {
        content += `---\n\n## MCP知识源: ${fileName}\n\n${fileContent}\n\n`;
      }
    }
    if (!ctx.business && !ctx.techStack && !ctx.api && !ctx.sdk && !ctx.external) {
      content += `> ⚠ 未注入任何项目知识。建议执行 x-spec knowledge\n`;
    }
    return content;
  }

  private copyDirRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);
      if (fs.statSync(srcPath).isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
