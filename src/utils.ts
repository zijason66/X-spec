import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

// ─── 配置模型 ───

export interface XSpecConfig {
  version: string;
  profile: 'standard' | 'extended' | 'minimal';
  'spec-engine': {
    'specs-dir': string;
    'changes-dir': string;
    'archive-dir': string;
    'scenario-format': string;
    'requirement-keyword': string;
  };
  workflow: {
    'workflows-dir': string;
    'workflow-templates-dir': string;
    'default-timeout': number;
    'step-validation': boolean;
  };
  template: {
    'templates-dir': string;
    'workflow-templates-dir': string;
    'code-templates-dir': string;
    engine: string;
  };
  knowledge: {
    'knowledge-dir': string;
    categories: string[];
  };
  /** 开发模式配置 */
  mode?: {
    /** 低于此行数推荐对话式（默认 100） */
    'conversational-max': number;
    /** 低于此行数推荐 SuperPower（默认 500），超过则推荐 SDD */
    'superpower-max': number;
  };
  /** 方案审核配置 */
  review?: {
    'auto-review-on-propose': boolean;
    'min-rounds': number;
    'max-rounds': number;
    'auto-approve-score': number;
    'require-human-approval': boolean;
    'review-dimensions'?: string[];
  };
  /** MCP 外部知识源配置 */
  'mcp-knowledge'?: {
    enabled: boolean;
    sources: Array<{
      name: string;
      type: 'code-graph' | 'knowledge-base' | 'custom';
      description: string;
      server: {
        command: string;
        args?: string[];
        env?: Record<string, string>;
        transport?: string;
        url?: string;
      };
      tool: string;
      toolParams?: Record<string, string>;
      outputFile: string;
      autoInject?: boolean;
      prompt?: string;
    }>;
  };
  sdd: {
    mode: string;
    'auto-verify': boolean;
    'strict-scenario-match': boolean;
    'proposal-required': boolean;
    'knowledge-required': boolean;
    'default-pipeline': string;
  };
}

// ─── 路径工具 ───

export function resolveProjectRoot(projectPath?: string): string {
  return path.resolve(projectPath || process.cwd());
}

export function getXSpecRoot(projectRoot: string): string {
  return path.join(projectRoot, 'x-spec');
}

// ─── 配置操作 ───

export function loadConfig(projectRoot: string): XSpecConfig | null {
  const configPath = path.join(getXSpecRoot(projectRoot), 'x-spec.yml');
  if (!fs.existsSync(configPath)) return null;
  return YAML.parse(fs.readFileSync(configPath, 'utf-8')) as XSpecConfig;
}

export function isInitialized(projectRoot: string): boolean {
  return fs.existsSync(path.join(getXSpecRoot(projectRoot), 'x-spec.yml'));
}

export function ensureInitialized(projectRoot: string): XSpecConfig {
  const config = loadConfig(projectRoot);
  if (!config) {
    console.error(chalk.red('项目未初始化。请先执行 x-spec init'));
    process.exit(1);
  }
  return config;
}

export function writeYAML(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, YAML.stringify(data), 'utf-8');
}

export function writeMarkdown(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}
