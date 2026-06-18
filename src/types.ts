// ─── 规范文件模型 ───

export interface Scenario {
  name: string;
  given: string;
  when: string;
  then: string;
  and: string[];
}

export interface Requirement {
  name: string;
  description: string;
  scenarios: Scenario[];
}

export interface SpecFile {
  module: string;
  purpose: string;
  requirements: Requirement[];
}

// ─── 变更提案模型 ───

export type ProposalStatus = 'DRAFT' | 'PROPOSED' | 'IN_REVIEW' | 'APPROVED' | 'APPLYING' | 'COMPLETED' | 'ARCHIVED';

export interface ChangeProposal {
  name: string;
  description: string;
  status: ProposalStatus;
  specDeltas: SpecDelta[];
}

// ─── 规范增量模型 ───

export type DeltaType = 'ADD' | 'MODIFY' | 'REMOVE';
export type DeltaAction = 'ADD' | 'MODIFY' | 'REMOVE';

export interface ScenarioDelta {
  scenarioName: string;
  action: DeltaAction;
  given?: string;
  when?: string;
  then?: string;
}

export interface RequirementDelta {
  requirementName: string;
  action: DeltaAction;
  before?: string;
  after?: string;
  scenarioDeltas: ScenarioDelta[];
}

export interface SpecDelta {
  specName: string;
  type: DeltaType;
  content?: string;
  requirementDeltas: RequirementDelta[];
}

// ─── 任务清单模型 ───

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED | FAILED';

export interface TaskItem {
  id: string;
  description: string;
  status: TaskStatus;
  dependsOn: string[];
  artifact?: string;
}

export interface TaskList {
  tasks: TaskItem[];
}

// ─── 验证结果模型 ───

export type Severity = 'ERROR' | 'WARNING' | 'INFO';

export interface Deviation {
  severity: Severity;
  specName?: string;
  scenarioName?: string;
  message: string;
  suggestion?: string;
}

export interface VerificationResult {
  consistent: boolean;
  deviations: Deviation[];
  totalScenarios: number;
  matchedScenarios: number;
}

// ─── 工作流模型 ───

export interface WorkflowStep {
  name: string;
  description: string;
  action?: string;
  required: boolean;
  depends_on: string[];
  condition?: { type: string; value: string };
  timeout?: number;
}

export type HookType = 'BEFORE_WORKFLOW' | 'AFTER_WORKFLOW' | 'BEFORE_STEP' | 'AFTER_STEP' | 'ON_ERROR';

export interface WorkflowHook {
  type: HookType;
  action: string;
  params: string[];
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  version: string;
  steps: WorkflowStep[];
  hooks: WorkflowHook[];
}

export type StepStatus = 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface WorkflowContext {
  workflowName: string;
  currentStatus: StepStatus;
  currentStepIndex: number;
  startTime: number;
  endTime: number;
}

// ─── 流程模板模型 ───

export interface WorkflowTemplate {
  name: string;
  description: string;
  version: string;
  stages: WorkflowStage[];
}

export interface WorkflowStage {
  name: string;
  description: string;
  command: string;
  required: boolean;
  depends_on: string[];
  params?: Record<string, string>;
  output?: string;
}

// ─── 流程执行模型 ───

export interface PipelineRun {
  templateName: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PAUSED';
  stages: PipelineStageRun[];
  startTime: number;
  endTime: number;
  currentStageIndex: number;
}

export interface PipelineStageRun {
  name: string;
  status: StepStatus;
  startTime: number;
  endTime: number;
  message: string;
}

// ─── 模板模型 ───

export interface TemplateManifest {
  name: string;
  description?: string;
  'source-path': string;
  variables: string[];
  'required-variables': string[];
  'created-at': string;
  'file-patterns': string[];
}

// ─── 知识模型 ───

export interface KnowledgeContext {
  business: string | null;
  techStack: string | null;
  api: string | null;
  sdk: string | null;
  /** MCP 外部知识源注入结果，key 为配置中的 source name */
  external?: Record<string, string>;
}

// ─── MCP 知识源配置模型 ───

export type McpTransport = 'stdio' | 'sse' | 'streamable-http';

export interface McpKnowledgeSource {
  /** 知识源唯一名称，用于引用和去重 */
  name: string;
  /** 知识源类型标识 */
  type: 'code-graph' | 'knowledge-base' | 'custom';
  /** 知识源功能描述，供 AI 理解用途 */
  description: string;
  /** MCP 服务器连接配置 */
  server: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    transport?: McpTransport;
    url?: string;
  };
  /** 要调用的 MCP tool 名称 */
  tool: string;
  /** 调用 tool 时传入的参数模板，支持 {{变量}} 占位 */
  toolParams?: Record<string, string>;
  /** 注入后写入 knowledge/ 目录的文件名 */
  outputFile: string;
  /** 是否在 knowledge 阶段自动调用（false 时需手动指定） */
  autoInject?: boolean;
  /** 注入时使用的提示词，引导 AI 理解和提炼 MCP 返回的内容 */
  prompt?: string;
}

export interface McpKnowledgeConfig {
  /** 是否启用 MCP 知识源注入 */
  enabled: boolean;
  /** 知识源列表 */
  sources: McpKnowledgeSource[];
}

// ─── 方案审核模型 ───

export type ReviewVerdict = 'APPROVED' | 'NEEDS_REVISION' | 'REJECTED';

export interface ReviewIssue {
  severity: 'ERROR' | 'WARNING' | 'SUGGESTION';
  location: string;         // 指向哪个文件/章节
  description: string;      // 问题描述
  suggestion?: string;      // 修改建议
}

export interface ReviewRound {
  round: number;            // 第几轮 (1-3)
  timestamp: string;
  reviewer: string;         // subagent 标识
  verdict: ReviewVerdict;
  score: number;            // 0-100
  issues: ReviewIssue[];
  summary: string;          // 综合评审意见
  revisionHints?: string;   // 给下一轮修订的提示
}

export interface ProposalReviewState {
  changeName: string;
  status: 'PENDING_REVIEW' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'AWAITING_HUMAN';
  rounds: ReviewRound[];
  currentRound: number;     // 1-3
  maxRounds: number;        // 配置值，默认3
  minRounds: number;        // 配置值，默认1
  humanApproved?: boolean;
  humanComment?: string;
  approvedAt?: string;
}

export interface ReviewConfig {
  /** 是否启用自动审核 */
  enabled: boolean;
  /** 最少审核轮数（至少1轮） */
  minRounds: number;
  /** 最多审核轮数（最多3轮） */
  maxRounds: number;
  /** 自动通过的最低分数（0-100） */
  autoApproveScore: number;
  /** 提案生成后是否自动触发审核 */
  autoReviewOnPropose: boolean;
  /** 是否需要人工确认后才能进入编码阶段 */
  requireHumanApproval: boolean;
  /** 审核维度（用于引导 subagent） */
  reviewDimensions: string[];
}

// ─── 开发模式模型 ───

/**
 * 开发模式：根据需求代码量自动路由到合适的开发流程
 *
 * - CONVERSATIONAL : <100行  → 直接对话式，无需结构化流程，给出建议即可
 * - SUPERPOWER     : 100-500行 → SuperPower 快速交付模式，简化流程但必须沉淀 spec
 * - SDD            : >500行  → 完整规范驱动开发流程（知识注入→提案→审核→编码→验证→归档）
 */
export type DevMode = 'CONVERSATIONAL' | 'SUPERPOWER' | 'SDD';

export interface ModeThresholds {
  /** 低于此行数推荐对话式（默认 100） */
  conversationalMax: number;
  /** 低于此行数推荐 SuperPower（默认 500），超过则推荐 SDD */
  superpowerMax: number;
}

export interface ModeEstimate {
  /** 估算的代码行数 */
  estimatedLines: number;
  /** 推荐的开发模式 */
  recommendedMode: DevMode;
  /** 推荐理由 */
  rationale: string;
  /** 是否为用户覆盖（手动指定） */
  userOverride: boolean;
}

export interface SuperPowerSession {
  /** 变更名称 */
  changeName: string;
  /** 需求描述 */
  description: string;
  /** 估算行数 */
  estimatedLines: number;
  /** 创建时间 */
  createdAt: string;
  /** 状态 */
  status: 'IMPLEMENTING' | 'SPEC_PENDING' | 'COMPLETED';
  /** 生成的 spec 文件路径 */
  specFile?: string;
  /** 完成时间 */
  completedAt?: string;
}

// ─── 执行层流转模型 ───

/**
 * 执行层（Superpowers）内部四阶段自动流转
 * brainstorm → plan → execute → finish
 */
export type ExecPhase = 'brainstorm' | 'plan' | 'execute' | 'finish';

export type ExecPhaseStatus = 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'BLOCKED';

export interface ExecPhaseRun {
  phase: ExecPhase;
  status: ExecPhaseStatus;
  startTime: number;
  endTime: number;
  message: string;
  /** 本阶段产出的文件路径列表 */
  outputs: string[];
}

export interface ExecPipelineRun {
  changeName: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'BLOCKED';
  phases: ExecPhaseRun[];
  startTime: number;
  endTime: number;
  /** 阻塞时等待人工介入的说明 */
  blockedReason?: string;
}

export interface ExecPipelineConfig {
  /** 是否启用执行层自动流转（默认 true） */
  autoTransition: boolean;
  /**
   * execute 阶段失败后的处理策略：
   * - 'block'  : 阻塞并等待人工介入（默认）
   * - 'retry'  : 自动重试（最多 maxRetries 次）
   * - 'skip'   : 跳过失败任务继续
   */
  onExecuteFailure: 'block' | 'retry' | 'skip';
  maxRetries: number;
  /** 是否在 finish 阶段触发代码审查检测 */
  codeReviewOnFinish: boolean;
  /** finish 通过后是否自动触发 verify */
  autoVerifyAfterFinish: boolean;
}

// ─── 斜杠命令模型 ───

export interface CommandResult {
  success: boolean;
  message: string;
  data: Record<string, unknown>;
}

// ─── 工件模型 ───

export type ArtifactType = 'MARKDOWN' | 'SPEC_DELTA' | 'YAML' | 'TEMPLATE';

export interface Artifact {
  name: string;
  type: ArtifactType;
  content: string;
}

export interface ArtifactBundle {
  proposalName: string;
  artifacts: Artifact[];
}
