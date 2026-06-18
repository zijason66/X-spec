/**
 * 方案自动审核引擎
 *
 * 职责：
 * 1. 驱动 1-3 轮 subagent 审核循环
 * 2. 持久化每轮审核结果到 review-state.json
 * 3. 基于评分决定是否需要修订或直接通过
 * 4. 生成结构化的 review-report.md
 * 5. 支持人工确认钩子（输出等待确认标记后由外部命令推进）
 */

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import type {
  ReviewRound,
  ReviewIssue,
  ReviewVerdict,
  ProposalReviewState,
  ReviewConfig,
} from '../types.js';

// ─── 默认配置 ───

export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  enabled: true,
  minRounds: 1,
  maxRounds: 3,
  autoApproveScore: 80,
  autoReviewOnPropose: true,
  requireHumanApproval: true,
  reviewDimensions: [
    '需求完整性：proposal.md 是否清晰描述了动机、影响范围和成功标准',
    '技术可行性：design.md 中的方案是否在已有技术栈约束下可实现',
    '任务拆解合理性：tasks.md 中的任务是否粒度适中、依赖清晰',
    '规范一致性：specs/ 增量是否符合 Given-When-Then 格式且覆盖关键场景',
    '知识引用完整性：knowledge-ref.md 是否正确引用了相关业务知识和代码结构',
  ],
};

export class ProposalReviewer {
  private readonly changeDir: string;
  private readonly stateFile: string;
  private readonly reportFile: string;
  private readonly config: ReviewConfig;

  constructor(changeDir: string, config?: Partial<ReviewConfig>) {
    this.changeDir = changeDir;
    this.stateFile = path.join(changeDir, 'review-state.json');
    this.reportFile = path.join(changeDir, 'review-report.md');
    this.config = { ...DEFAULT_REVIEW_CONFIG, ...config };
  }

  // ─── 公共 API ───

  /** 初始化审核状态（首次调用） */
  initState(changeName: string): ProposalReviewState {
    const state: ProposalReviewState = {
      changeName,
      status: 'PENDING_REVIEW',
      rounds: [],
      currentRound: 0,
      maxRounds: Math.min(this.config.maxRounds, 3),
      minRounds: Math.max(this.config.minRounds, 1),
    };
    this.saveState(state);
    return state;
  }

  /** 读取当前审核状态 */
  loadState(): ProposalReviewState | null {
    if (!fs.existsSync(this.stateFile)) return null;
    return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
  }

  /** 执行一轮 subagent 审核（读取提案文件，生成结构化 prompt，输出审核结果） */
  async runReviewRound(state: ProposalReviewState): Promise<ReviewRound> {
    const roundNum = state.currentRound + 1;
    console.log(chalk.cyan(`\n[审核] 第 ${roundNum}/${state.maxRounds} 轮 Subagent 自动审核...`));

    // 读取提案文件
    const proposalContent = this.readChangeFile('proposal.md');
    const designContent = this.readChangeFile('design.md');
    const tasksContent = this.readChangeFile('tasks.md');
    const knowledgeRefContent = this.readChangeFile('knowledge-ref.md');
    const specsContent = this.readSpecsDelta();
    const prevRoundContext = roundNum > 1 ? this.buildPrevRoundContext(state) : '';

    // 构造审核 prompt（供 subagent/AI 处理）
    const reviewPrompt = this.buildReviewPrompt({
      roundNum,
      maxRounds: state.maxRounds,
      proposalContent,
      designContent,
      tasksContent,
      knowledgeRefContent,
      specsContent,
      prevRoundContext,
      dimensions: this.config.reviewDimensions,
    });

    // 将 prompt 写出，让上层（AI 工具或 subagent）读取并回填结果
    const promptFile = path.join(this.changeDir, `review-prompt-r${roundNum}.md`);
    fs.writeFileSync(promptFile, reviewPrompt, 'utf-8');

    console.log(chalk.gray(`  审核 Prompt 已写入: ${path.relative(process.cwd(), promptFile)}`));
    console.log(chalk.yellow(`  → Subagent 正在执行审核，请稍候...`));

    // 执行 subagent 审核（基于文件内容的规则分析）
    const round = await this.executeSubagentReview(roundNum, state, {
      proposal: proposalContent,
      design: designContent,
      tasks: tasksContent,
      knowledgeRef: knowledgeRefContent,
      specs: specsContent,
    });

    // 更新状态
    state.rounds.push(round);
    state.currentRound = roundNum;
    state.status = 'IN_REVIEW';
    this.saveState(state);

    // 更新审核报告
    this.generateReport(state);

    return round;
  }

  /** 判断是否应继续下一轮审核 */
  shouldContinueReview(state: ProposalReviewState, lastRound: ReviewRound): boolean {
    // 已达最大轮数 → 停止
    if (state.currentRound >= state.maxRounds) return false;

    // 已满足最少轮数 且 分数达到自动通过阈值 → 停止
    if (
      state.currentRound >= state.minRounds &&
      lastRound.score >= this.config.autoApproveScore &&
      lastRound.verdict === 'APPROVED'
    ) {
      return false;
    }

    // REJECTED（严重问题）且已达最少轮数 → 停止，让人工介入
    if (lastRound.verdict === 'REJECTED' && state.currentRound >= state.minRounds) {
      return false;
    }

    // NEEDS_REVISION 且还有剩余轮数 → 继续
    return lastRound.verdict === 'NEEDS_REVISION';
  }

  /** 标记审核完成，等待人工确认 */
  markAwaitingHuman(state: ProposalReviewState): void {
    state.status = 'AWAITING_HUMAN';
    this.saveState(state);
    this.generateReport(state);
  }

  /** 人工确认审批通过 */
  humanApprove(state: ProposalReviewState, comment?: string): void {
    state.humanApproved = true;
    state.humanComment = comment;
    state.approvedAt = new Date().toISOString();
    state.status = 'APPROVED';
    this.saveState(state);
    this.generateReport(state);
  }

  /** 人工驳回 */
  humanReject(state: ProposalReviewState, comment: string): void {
    state.humanApproved = false;
    state.humanComment = comment;
    state.status = 'REJECTED';
    this.saveState(state);
    this.generateReport(state);
  }

  /** 检查提案是否已获人工批准（可进入编码阶段） */
  isApprovedForImplementation(state: ProposalReviewState): boolean {
    if (!this.config.requireHumanApproval) {
      // 不要求人工审批，检查自动审核是否通过
      const lastRound = state.rounds[state.rounds.length - 1];
      return !!(
        state.currentRound >= state.minRounds &&
        lastRound &&
        (lastRound.verdict === 'APPROVED' || lastRound.score >= this.config.autoApproveScore)
      );
    }
    return state.status === 'APPROVED' && state.humanApproved === true;
  }

  // ─── Subagent 审核实现 ───

  /**
   * 执行 subagent 审核
   * 基于结构化规则分析提案文件，模拟专业代码/架构审核员的判断逻辑
   */
  private async executeSubagentReview(
    roundNum: number,
    state: ProposalReviewState,
    files: {
      proposal: string;
      design: string;
      tasks: string;
      knowledgeRef: string;
      specs: string;
    },
  ): Promise<ReviewRound> {
    const issues: ReviewIssue[] = [];
    let score = 100;

    // ── 维度1：需求完整性检查（proposal.md）──
    if (!files.proposal || files.proposal.trim().length < 50) {
      issues.push({
        severity: 'ERROR',
        location: 'proposal.md',
        description: 'proposal.md 内容过短或不存在，缺少必要的变更描述',
        suggestion: '补充变更描述、动机和影响范围',
      });
      score -= 25;
    } else {
      if (!files.proposal.includes('## 动机') && !files.proposal.includes('## Motivation')) {
        issues.push({
          severity: 'WARNING',
          location: 'proposal.md § 动机',
          description: '缺少动机说明章节',
          suggestion: '在 proposal.md 中添加 ## 动机 章节，说明为什么需要此变更',
        });
        score -= 8;
      }
      if (!files.proposal.includes('## 影响范围') && !files.proposal.includes('## Impact')) {
        issues.push({
          severity: 'WARNING',
          location: 'proposal.md § 影响范围',
          description: '缺少影响范围说明',
          suggestion: '在 proposal.md 中列出受影响的模块和规范',
        });
        score -= 8;
      }
      // 检查动机/影响范围是否还是模板占位符
      if (files.proposal.includes('<!-- 描述为什么要做这个变更 -->')) {
        issues.push({
          severity: 'WARNING',
          location: 'proposal.md § 动机',
          description: '动机章节仍为模板占位符，未填写实际内容',
          suggestion: '用实际的业务或技术动机替换占位符注释',
        });
        score -= 10;
      }
      if (files.proposal.includes('<!-- 列出受影响的模块和规范 -->')) {
        issues.push({
          severity: 'WARNING',
          location: 'proposal.md § 影响范围',
          description: '影响范围章节仍为模板占位符',
          suggestion: '列举具体受影响的模块、文件或规范名称',
        });
        score -= 10;
      }
    }

    // ── 维度2：技术可行性检查（design.md）──
    if (!files.design || files.design.trim().length < 50) {
      issues.push({
        severity: 'ERROR',
        location: 'design.md',
        description: 'design.md 内容过短，技术设计不完整',
        suggestion: '补充技术方案、设计决策和替代方案分析',
      });
      score -= 20;
    } else {
      if (!files.design.includes('## 技术方案') && !files.design.includes('## Technical')) {
        issues.push({
          severity: 'WARNING',
          location: 'design.md § 技术方案',
          description: '缺少技术方案章节',
          suggestion: '描述具体的实现技术方案',
        });
        score -= 8;
      }
      if (files.design.includes('<!-- 描述实现的技术方案 -->')) {
        issues.push({
          severity: 'WARNING',
          location: 'design.md § 技术方案',
          description: '技术方案章节仍为模板占位符',
          suggestion: '填写具体的技术实现方案',
        });
        score -= 12;
      }
      if (!files.design.includes('## 设计决策') && !files.design.includes('## Decision')) {
        issues.push({
          severity: 'SUGGESTION',
          location: 'design.md § 设计决策',
          description: '建议补充设计决策说明，记录关键技术选型的理由',
          suggestion: '添加 ## 设计决策 章节，解释为什么选择该技术方案',
        });
        score -= 3;
      }
      if (!files.design.includes('## 风险') && !files.design.includes('## Risk')) {
        issues.push({
          severity: 'SUGGESTION',
          location: 'design.md § 风险',
          description: '建议补充风险评估',
          suggestion: '添加 ## 风险与缓解 章节',
        });
        score -= 3;
      }
    }

    // ── 维度3：任务拆解合理性（tasks.md）──
    if (!files.tasks || files.tasks.trim().length < 20) {
      issues.push({
        severity: 'ERROR',
        location: 'tasks.md',
        description: 'tasks.md 不存在或内容为空',
        suggestion: '创建任务清单并分解实现步骤',
      });
      score -= 20;
    } else {
      const taskCount = (files.tasks.match(/^- \[[ x~!]\]/gm) || []).length;
      if (taskCount === 0) {
        issues.push({
          severity: 'ERROR',
          location: 'tasks.md',
          description: '没有找到任何任务条目（格式: - [ ] 任务描述）',
          suggestion: '按 - [ ] T1: 描述 格式添加具体任务',
        });
        score -= 15;
      } else if (taskCount < 3) {
        issues.push({
          severity: 'WARNING',
          location: 'tasks.md',
          description: `任务数量过少（${taskCount} 项），可能任务拆解粒度太粗`,
          suggestion: '将大任务拆分为更细粒度的步骤，建议至少包含：需求分析、核心实现、测试、文档',
        });
        score -= 5;
      }
      // 检查是否包含测试任务
      if (!files.tasks.toLowerCase().includes('测试') && !files.tasks.toLowerCase().includes('test')) {
        issues.push({
          severity: 'WARNING',
          location: 'tasks.md § 测试任务',
          description: '未包含测试相关任务',
          suggestion: '添加单元测试或集成测试任务',
        });
        score -= 5;
      }
    }

    // ── 维度4：规范增量格式（specs/）──
    if (files.specs && files.specs.trim().length > 10) {
      const hasGiven = files.specs.includes('- GIVEN') || files.specs.includes('- 假设');
      const hasWhen = files.specs.includes('- WHEN') || files.specs.includes('- 当');
      const hasThen = files.specs.includes('- THEN') || files.specs.includes('- 则');
      if (!hasGiven || !hasWhen || !hasThen) {
        issues.push({
          severity: 'WARNING',
          location: 'specs/ § Given-When-Then',
          description: '规范增量中缺少完整的 Given-When-Then 场景结构',
          suggestion: '确保每个 Scenario 都包含 GIVEN / WHEN / THEN 三个元素',
        });
        score -= 8;
      }
    }

    // ── 维度5：知识引用（knowledge-ref.md）──
    if (!files.knowledgeRef || files.knowledgeRef.includes('未注入任何项目知识')) {
      issues.push({
        severity: 'SUGGESTION',
        location: 'knowledge-ref.md',
        description: '未注入项目知识上下文，设计可能缺少业务依据',
        suggestion: '执行 x-spec knowledge 注入业务背景、技术栈等知识',
      });
      score -= 3;
    }

    // ── 轮次奖励：第2/3轮如果前一轮有 NEEDS_REVISION，检查是否有改进 ──
    if (roundNum > 1) {
      const prevRound = state.rounds[state.rounds.length - 1];
      const prevIssueCount = prevRound.issues.filter(i => i.severity !== 'SUGGESTION').length;
      const currentIssueCount = issues.filter(i => i.severity !== 'SUGGESTION').length;
      if (currentIssueCount < prevIssueCount) {
        const improvement = prevIssueCount - currentIssueCount;
        score = Math.min(100, score + improvement * 3);
        console.log(chalk.green(`  ✓ 相比第 ${prevRound.round} 轮，问题减少了 ${improvement} 项`));
      }
    }

    // 确保分数在 0-100 范围内
    score = Math.max(0, Math.min(100, score));

    // 确定审核结论
    let verdict: ReviewVerdict;
    const errorCount = issues.filter(i => i.severity === 'ERROR').length;
    const warningCount = issues.filter(i => i.severity === 'WARNING').length;

    if (errorCount > 0 || score < 40) {
      verdict = roundNum < state.maxRounds ? 'NEEDS_REVISION' : 'REJECTED';
    } else if (score >= this.config.autoApproveScore && warningCount <= 2) {
      verdict = 'APPROVED';
    } else {
      verdict = roundNum < state.maxRounds ? 'NEEDS_REVISION' : 'APPROVED';
    }

    // 生成综合评审意见
    const summary = this.buildReviewSummary(score, verdict, issues, roundNum, state.maxRounds);
    const revisionHints = verdict === 'NEEDS_REVISION'
      ? this.buildRevisionHints(issues)
      : undefined;

    const round: ReviewRound = {
      round: roundNum,
      timestamp: new Date().toISOString(),
      reviewer: `x-spec-subagent-r${roundNum}`,
      verdict,
      score,
      issues,
      summary,
      revisionHints,
    };

    this.printRoundResult(round);
    return round;
  }

  // ─── 报告生成 ───

  generateReport(state: ProposalReviewState): void {
    const lines: string[] = [
      `# 方案审核报告: ${state.changeName}`,
      '',
      `> 审核状态: **${this.statusLabel(state.status)}**`,
      `> 审核轮次: ${state.currentRound}/${state.maxRounds}`,
      `> 生成时间: ${new Date().toLocaleString('zh-CN')}`,
      '',
      '---',
      '',
    ];

    // 各轮次结果摘要
    if (state.rounds.length > 0) {
      lines.push('## 审核轮次摘要', '');
      lines.push('| 轮次 | 分数 | 结论 | 错误数 | 警告数 | 时间 |');
      lines.push('|------|------|------|--------|--------|------|');
      for (const r of state.rounds) {
        const errors = r.issues.filter(i => i.severity === 'ERROR').length;
        const warnings = r.issues.filter(i => i.severity === 'WARNING').length;
        const time = new Date(r.timestamp).toLocaleString('zh-CN');
        lines.push(`| R${r.round} | ${r.score}/100 | ${this.verdictLabel(r.verdict)} | ${errors} | ${warnings} | ${time} |`);
      }
      lines.push('');

      // 最后一轮详细结果
      const lastRound = state.rounds[state.rounds.length - 1];
      lines.push(`## 第 ${lastRound.round} 轮审核详情`, '');
      lines.push(`**评分：** ${lastRound.score}/100`);
      lines.push(`**结论：** ${this.verdictLabel(lastRound.verdict)}`);
      lines.push('');
      lines.push(`**综合意见：**`);
      lines.push('');
      lines.push(lastRound.summary);
      lines.push('');

      if (lastRound.issues.length > 0) {
        lines.push('**发现问题：**', '');
        for (const issue of lastRound.issues) {
          const icon = issue.severity === 'ERROR' ? '🔴' : issue.severity === 'WARNING' ? '🟡' : '🔵';
          lines.push(`- ${icon} **[${issue.severity}]** \`${issue.location}\``);
          lines.push(`  - 问题：${issue.description}`);
          if (issue.suggestion) lines.push(`  - 建议：${issue.suggestion}`);
        }
        lines.push('');
      }

      if (lastRound.revisionHints) {
        lines.push('**修订提示（下一轮）：**', '');
        lines.push(lastRound.revisionHints, '');
      }
    }

    // 人工确认区
    lines.push('---', '', '## 人工审核确认', '');
    if (state.status === 'AWAITING_HUMAN') {
      lines.push('> ⏳ **等待人工确认** — 自动审核已完成，请人工审查后执行:');
      lines.push('');
      lines.push('```bash');
      lines.push(`# 确认通过，进入编码实现阶段`);
      lines.push(`x-spec review approve ${state.changeName}             # 批准提案`);
      lines.push(`x-spec review approve ${state.changeName} -m "LGTM"  # 带备注批准`);
      lines.push('');
      lines.push(`# 驳回提案，需要重新设计`);
      lines.push(`x-spec review reject ${state.changeName} -m "需要重新设计数据模型"`);
      lines.push('```');
    } else if (state.status === 'APPROVED') {
      lines.push(`> ✅ **已批准** — ${new Date(state.approvedAt!).toLocaleString('zh-CN')}`);
      if (state.humanComment) lines.push(`> 备注：${state.humanComment}`);
      lines.push('');
      lines.push('**下一步：**');
      lines.push('```bash');
      lines.push(`x-spec apply ${state.changeName}  # 开始编码实现`);
      lines.push('```');
    } else if (state.status === 'REJECTED') {
      lines.push(`> ❌ **已驳回**`);
      if (state.humanComment) lines.push(`> 原因：${state.humanComment}`);
    }

    fs.writeFileSync(this.reportFile, lines.join('\n'), 'utf-8');
  }

  // ─── 辅助方法 ───

  private readChangeFile(filename: string): string {
    const filePath = path.join(this.changeDir, filename);
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8');
  }

  private readSpecsDelta(): string {
    const specsDir = path.join(this.changeDir, 'specs');
    if (!fs.existsSync(specsDir)) return '';
    const contents: string[] = [];
    for (const entry of fs.readdirSync(specsDir)) {
      const specFile = path.join(specsDir, entry, 'spec.md');
      if (fs.existsSync(specFile)) {
        contents.push(fs.readFileSync(specFile, 'utf-8'));
      }
    }
    return contents.join('\n\n---\n\n');
  }

  private saveState(state: ProposalReviewState): void {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf-8');
  }

  private buildReviewPrompt(opts: {
    roundNum: number;
    maxRounds: number;
    proposalContent: string;
    designContent: string;
    tasksContent: string;
    knowledgeRefContent: string;
    specsContent: string;
    prevRoundContext: string;
    dimensions: string[];
  }): string {
    const lines = [
      `# 方案审核 Prompt — 第 ${opts.roundNum}/${opts.maxRounds} 轮`,
      '',
      '## 审核任务',
      '',
      '你是一位资深软件架构师，请对以下变更提案进行严格的技术审核。',
      '',
      '## 审核维度',
      '',
      ...opts.dimensions.map((d, i) => `${i + 1}. ${d}`),
      '',
    ];

    if (opts.prevRoundContext) {
      lines.push('## 上轮审核结果（请对照改进情况评估）', '', opts.prevRoundContext, '');
    }

    lines.push(
      '## 待审核文件内容',
      '',
      '### proposal.md',
      '```markdown',
      opts.proposalContent || '（文件不存在）',
      '```',
      '',
      '### design.md',
      '```markdown',
      opts.designContent || '（文件不存在）',
      '```',
      '',
      '### tasks.md',
      '```markdown',
      opts.tasksContent || '（文件不存在）',
      '```',
      '',
    );

    if (opts.specsContent) {
      lines.push('### specs/ 增量', '```markdown', opts.specsContent, '```', '');
    }
    if (opts.knowledgeRefContent) {
      lines.push('### knowledge-ref.md', '```markdown', opts.knowledgeRefContent, '```', '');
    }

    lines.push(
      '## 输出要求',
      '',
      '请以 JSON 格式输出审核结果（该文件仅供参考，实际结果由引擎自动计算）：',
      '',
      '```json',
      '{',
      '  "score": <0-100>,',
      '  "verdict": "APPROVED|NEEDS_REVISION|REJECTED",',
      '  "issues": [{"severity": "ERROR|WARNING|SUGGESTION", "location": "...", "description": "...", "suggestion": "..."}],',
      '  "summary": "综合评审意见",',
      '  "revisionHints": "针对下一轮修订的具体提示（verdict为NEEDS_REVISION时填写）"',
      '}',
      '```',
    );

    return lines.join('\n');
  }

  private buildPrevRoundContext(state: ProposalReviewState): string {
    const prev = state.rounds[state.rounds.length - 1];
    if (!prev) return '';
    const issueLines = prev.issues
      .filter(i => i.severity !== 'SUGGESTION')
      .map(i => `  - [${i.severity}] ${i.location}: ${i.description}`)
      .join('\n');
    return `第 ${prev.round} 轮评分: ${prev.score}/100，结论: ${prev.verdict}\n主要问题:\n${issueLines || '  （无）'}`;
  }

  private buildReviewSummary(
    score: number,
    verdict: ReviewVerdict,
    issues: ReviewIssue[],
    roundNum: number,
    maxRounds: number,
  ): string {
    const errorCount = issues.filter(i => i.severity === 'ERROR').length;
    const warningCount = issues.filter(i => i.severity === 'WARNING').length;
    const suggCount = issues.filter(i => i.severity === 'SUGGESTION').length;

    const verdictText = {
      APPROVED: `方案整体质量良好（${score}分），可以进入编码实现阶段`,
      NEEDS_REVISION: `方案存在需要修订的问题（${score}分），请根据审核意见修改后继续`,
      REJECTED: `方案质量不达标（${score}分），建议重新设计`,
    }[verdict];

    const issueText = errorCount > 0 || warningCount > 0
      ? `发现 ${errorCount} 个错误、${warningCount} 个警告、${suggCount} 条建议。`
      : `未发现严重问题${suggCount > 0 ? `，有 ${suggCount} 条优化建议` : ''}。`;

    const roundText = roundNum === maxRounds && verdict !== 'APPROVED'
      ? '已达最大审核轮数。'
      : '';

    return `${verdictText}。${issueText}${roundText}`.trim();
  }

  private buildRevisionHints(issues: ReviewIssue[]): string {
    const criticalIssues = issues.filter(i => i.severity !== 'SUGGESTION');
    if (criticalIssues.length === 0) return '';
    const lines = ['优先修复以下问题后提交下一轮审核：', ''];
    criticalIssues.forEach((issue, idx) => {
      lines.push(`${idx + 1}. **${issue.location}**: ${issue.description}`);
      if (issue.suggestion) lines.push(`   → ${issue.suggestion}`);
    });
    return lines.join('\n');
  }

  private printRoundResult(round: ReviewRound): void {
    const scoreColor = round.score >= 80 ? chalk.green : round.score >= 60 ? chalk.yellow : chalk.red;
    const verdictIcon = { APPROVED: '✅', NEEDS_REVISION: '🔄', REJECTED: '❌' }[round.verdict];
    console.log(chalk.bold(`\n  [R${round.round}] ${verdictIcon} ${this.verdictLabel(round.verdict)} | 评分: ${scoreColor(round.score + '/100')}`));
    console.log(chalk.gray(`  ${round.summary}`));
    const errors = round.issues.filter(i => i.severity === 'ERROR');
    const warnings = round.issues.filter(i => i.severity === 'WARNING');
    if (errors.length > 0) {
      console.log(chalk.red(`\n  错误 (${errors.length}):`));
      errors.forEach(e => console.log(chalk.red(`    ✗ [${e.location}] ${e.description}`)));
    }
    if (warnings.length > 0) {
      console.log(chalk.yellow(`\n  警告 (${warnings.length}):`));
      warnings.forEach(w => console.log(chalk.yellow(`    △ [${w.location}] ${w.description}`)));
    }
  }

  private statusLabel(status: string): string {
    const labels: Record<string, string> = {
      PENDING_REVIEW: '待审核',
      IN_REVIEW: '审核中',
      APPROVED: '已批准',
      REJECTED: '已驳回',
      AWAITING_HUMAN: '等待人工确认',
    };
    return labels[status] || status;
  }

  private verdictLabel(verdict: ReviewVerdict): string {
    return { APPROVED: '通过', NEEDS_REVISION: '需要修订', REJECTED: '驳回' }[verdict];
  }
}
