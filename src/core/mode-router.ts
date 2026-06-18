/**
 * 开发模式路由引擎
 *
 * 职责：
 * 1. 根据需求描述估算代码行数（启发式规则 + 关键词分析）
 * 2. 路由到合适的开发模式（CONVERSATIONAL / SUPERPOWER / SDD）
 * 3. 为 SuperPower 模式生成简化的 spec 沉淀文档
 * 4. 持久化 SuperPower 会话状态
 */

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import type { DevMode, ModeThresholds, ModeEstimate, SuperPowerSession } from '../types.js';

// ─── 默认阈值配置 ───

export const DEFAULT_MODE_THRESHOLDS: ModeThresholds = {
  conversationalMax: 100,
  superpowerMax: 500,
};

// ─── 复杂度关键词权重表 ───

const COMPLEXITY_KEYWORDS: Array<{ pattern: RegExp; weight: number; reason: string }> = [
  // 高复杂度（+50~150行/项）
  { pattern: /数据库|database|DB|持久化|ORM|迁移|migration/i, weight: 80, reason: '数据库操作' },
  { pattern: /认证|鉴权|auth|JWT|OAuth|登录|权限|RBAC/i, weight: 120, reason: '认证授权系统' },
  { pattern: /微服务|分布式|RPC|消息队列|MQ|Kafka|RabbitMQ/i, weight: 150, reason: '分布式系统' },
  { pattern: /API接口|REST API|GraphQL|WebSocket/i, weight: 80, reason: 'API层实现' },
  { pattern: /支付|payment|结算|财务|账单/i, weight: 100, reason: '支付金融相关' },
  { pattern: /搜索|全文检索|Elasticsearch|Solr/i, weight: 100, reason: '搜索功能' },
  { pattern: /文件上传|存储|OSS|S3|CDN/i, weight: 60, reason: '文件存储' },
  { pattern: /缓存|Redis|Cache|Memcached/i, weight: 50, reason: '缓存层' },
  { pattern: /实时|WebRTC|Socket\.io|推送/i, weight: 80, reason: '实时通信' },
  { pattern: /报表|统计|图表|BI|数据分析/i, weight: 80, reason: '报表统计' },
  // 中等复杂度（+20~50行/项）
  { pattern: /表单|Form|CRUD|增删改查/i, weight: 40, reason: 'CRUD操作' },
  { pattern: /列表|分页|筛选|排序/i, weight: 30, reason: '列表功能' },
  { pattern: /通知|邮件|短信|推送/i, weight: 40, reason: '通知系统' },
  { pattern: /配置|设置|preferences|settings/i, weight: 25, reason: '配置管理' },
  { pattern: /导入|导出|Excel|CSV/i, weight: 50, reason: '导入导出' },
  { pattern: /测试|单元测试|集成测试|Test/i, weight: 30, reason: '测试代码' },
  // 低复杂度（+5~15行/项）
  { pattern: /修复|bugfix|fix|修改|调整/i, weight: 15, reason: '问题修复' },
  { pattern: /样式|CSS|UI|界面|布局/i, weight: 20, reason: 'UI样式' },
  { pattern: /文档|注释|README|doc/i, weight: 5, reason: '文档更新' },
  { pattern: /重构|refactor|优化|performance/i, weight: 30, reason: '重构优化' },
];

// 数量关键词乘数
const QUANTITY_MULTIPLIERS: Array<{ pattern: RegExp; multiplier: number }> = [
  { pattern: /多个|多种|多类|几个|批量|全部|所有/i, multiplier: 2.5 },
  { pattern: /完整|全面|系统|模块|整套/i, multiplier: 3.0 },
  { pattern: /简单|简易|基础|基本|仅|只需/i, multiplier: 0.4 },
  { pattern: /一个|一项|单个|单一/i, multiplier: 0.8 },
];

export class ModeRouter {
  private readonly thresholds: ModeThresholds;

  constructor(thresholds?: Partial<ModeThresholds>) {
    this.thresholds = { ...DEFAULT_MODE_THRESHOLDS, ...thresholds };
  }

  // ─── 公共 API ───

  /**
   * 分析需求描述，估算代码行数并推荐开发模式
   */
  estimate(description: string): ModeEstimate {
    const estimatedLines = this.estimateLines(description);
    const recommendedMode = this.routeMode(estimatedLines);
    const rationale = this.buildRationale(description, estimatedLines, recommendedMode);
    return { estimatedLines, recommendedMode, rationale, userOverride: false };
  }

  /**
   * 根据用户手动指定的模式覆盖推荐
   */
  override(description: string, mode: DevMode): ModeEstimate {
    const estimate = this.estimate(description);
    return {
      ...estimate,
      recommendedMode: mode,
      rationale: `用户手动指定 ${mode} 模式（估算行数: ~${estimate.estimatedLines} 行）`,
      userOverride: true,
    };
  }

  /**
   * 路由决策：根据行数返回模式
   */
  routeMode(estimatedLines: number): DevMode {
    if (estimatedLines < this.thresholds.conversationalMax) return 'CONVERSATIONAL';
    if (estimatedLines < this.thresholds.superpowerMax) return 'SUPERPOWER';
    return 'SDD';
  }

  /**
   * 打印模式推荐信息
   */
  printRecommendation(estimate: ModeEstimate): void {
    const modeConfig = MODE_DISPLAY[estimate.recommendedMode];
    console.log();
    console.log(chalk.cyan('─── 开发模式评估 ───'));
    console.log(`估算代码量: ${chalk.bold('~' + estimate.estimatedLines + ' 行')}`);
    console.log(`推荐模式:   ${chalk[modeConfig.color as 'green' | 'yellow' | 'blue'](modeConfig.icon + ' ' + modeConfig.label)}`);
    console.log(chalk.gray(`理由: ${estimate.rationale}`));
    if (estimate.userOverride) {
      console.log(chalk.yellow('（已手动覆盖推荐模式）'));
    }
    console.log();
    console.log(modeConfig.description);
    console.log();
  }

  /**
   * 为 SuperPower 模式生成简化的 spec 沉淀文档
   * 每轮需求开发结束后调用，将本轮功能沉淀为 spec 文件
   */
  generateSuperpowerSpec(session: SuperPowerSession, outputDir: string): string {
    const specContent = buildSuperpowerSpecContent(session);
    const specDir = path.join(outputDir, 'specs', session.changeName);
    fs.mkdirSync(specDir, { recursive: true });
    const specFile = path.join(specDir, 'spec.md');
    fs.writeFileSync(specFile, specContent, 'utf-8');
    return specFile;
  }

  /**
   * 保存 SuperPower 会话状态
   */
  saveSession(session: SuperPowerSession, xspecRoot: string): void {
    const sessionsDir = path.join(xspecRoot, 'superpower');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const file = path.join(sessionsDir, `${session.changeName}.json`);
    fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * 读取 SuperPower 会话状态
   */
  loadSession(changeName: string, xspecRoot: string): SuperPowerSession | null {
    const file = path.join(xspecRoot, 'superpower', `${changeName}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  }

  /**
   * 列出所有 SuperPower 会话
   */
  listSessions(xspecRoot: string): SuperPowerSession[] {
    const sessionsDir = path.join(xspecRoot, 'superpower');
    if (!fs.existsSync(sessionsDir)) return [];
    return fs
      .readdirSync(sessionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8')) as SuperPowerSession);
  }

  // ─── 内部估算逻辑 ───

  private estimateLines(description: string): number {
    let baseScore = 0;
    const matchedReasons: string[] = [];

    // 累积关键词权重
    for (const { pattern, weight, reason } of COMPLEXITY_KEYWORDS) {
      if (pattern.test(description)) {
        baseScore += weight;
        matchedReasons.push(reason);
      }
    }

    // 若没有任何关键词命中，给基础分
    if (baseScore === 0) {
      baseScore = 50; // 默认基础功能
    }

    // 应用数量修饰词乘数
    let multiplier = 1.0;
    for (const { pattern, multiplier: m } of QUANTITY_MULTIPLIERS) {
      if (pattern.test(description)) {
        multiplier = Math.max(multiplier, m);
      }
    }

    // 描述长度也是复杂度信号（每20字符+5行）
    const lengthBonus = Math.floor(description.length / 20) * 5;

    return Math.round((baseScore + lengthBonus) * multiplier);
  }

  private buildRationale(description: string, lines: number, mode: DevMode): string {
    const matched: string[] = [];
    for (const { pattern, reason } of COMPLEXITY_KEYWORDS) {
      if (pattern.test(description)) matched.push(reason);
    }
    const featureText = matched.length > 0 ? `涉及${matched.join('、')}` : '基础功能变更';
    const modeLabel = MODE_DISPLAY[mode].label;
    return `${featureText}，估算约 ~${lines} 行，适合使用${modeLabel}`;
  }
}

// ─── SuperPower Spec 生成 ───

function buildSuperpowerSpecContent(session: SuperPowerSession): string {
  const date = new Date(session.createdAt).toLocaleDateString('zh-CN');
  return `# SuperPower Spec: ${session.changeName}

> 开发模式: SuperPower 快速交付  
> 估算代码量: ~${session.estimatedLines} 行  
> 开发时间: ${date}

## 功能描述

${session.description}

---

## 功能规范（本轮交付）

### 需求：${session.description}

> 本规范由 x-spec SuperPower 模式自动沉淀，记录本轮开发的功能边界。

#### 场景：核心功能正常运作

- 假设 系统已具备运行所需的基础环境
- 当 用户触发该功能
- 则 系统**必须**按以下描述的行为响应：${session.description}
- 且 功能**必须**在正常负载下稳定运行

#### 场景：异常输入处理

- 假设 用户提供了无效或边界输入
- 当 功能被调用
- 则 系统**必须**给出友好的错误提示
- 且 **不得**产生未处理异常或数据损坏

---

## 交付记录

| 字段 | 值 |
|------|-----|
| 变更名称 | \`${session.changeName}\` |
| 开发模式 | SuperPower |
| 估算行数 | ~${session.estimatedLines} 行 |
| 开始时间 | ${new Date(session.createdAt).toLocaleString('zh-CN')} |
${session.completedAt ? `| 完成时间 | ${new Date(session.completedAt).toLocaleString('zh-CN')} |` : '| 状态 | 进行中 |'}

---

> **说明**: 此 spec 文件由 SuperPower 模式自动沉淀。  
> 如需更完整的需求覆盖，可使用 \`x-spec propose\` 在 SDD 模式下补充详细的 design.md 和 tasks.md。
`;
}

// ─── 模式展示配置 ───

export const MODE_DISPLAY: Record<DevMode, { label: string; icon: string; color: string; description: string }> = {
  CONVERSATIONAL: {
    label: '对话式开发',
    icon: '💬',
    color: 'blue',
    description: chalk.blue(
      '  对话式模式：代码量少，直接与 AI 对话完成即可。\n' +
      '  无需结构化流程，快速实现后可选择性沉淀到 spec。\n\n' +
      '  建议操作：直接描述需求，让 AI 生成代码'
    ),
  },
  SUPERPOWER: {
    label: 'SuperPower 快速交付',
    icon: '⚡',
    color: 'yellow',
    description: chalk.yellow(
      '  SuperPower 模式：中等规模需求，追求快速交付。\n' +
      '  简化开发流程（提案→编码→spec沉淀），跳过完整审核。\n' +
      '  每轮交付后自动生成 spec 文档记录本轮功能。\n\n' +
      '  建议操作：x-spec sp <描述>   （SuperPower 快速启动）'
    ),
  },
  SDD: {
    label: 'SDD 规范驱动开发',
    icon: '📋',
    color: 'green',
    description: chalk.green(
      '  SDD 完整模式：大型需求，严格规范驱动。\n' +
      '  完整流程：知识注入→提案→多轮审核→人工确认→编码→验证→归档。\n' +
      '  每个阶段均有文档沉淀，确保高质量交付。\n\n' +
      '  建议操作：x-spec propose <描述>   （启动完整 SDD 流程）'
    ),
  },
};
