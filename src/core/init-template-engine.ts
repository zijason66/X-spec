/**
 * Init 渲染模板引擎
 *
 * 职责：
 * 1. 管理 init 渲染模板（位于 x-spec/templates/init/<name>/）
 * 2. 加载 template.yml，按策略渲染 7 个 knowledge 索引文件
 * 3. 从默认模板派生新模板（脚手架）
 *
 * 模板目录结构示例：
 *   x-spec/templates/init/default/
 *     ├── template.yml          # 元数据 + outputs 策略
 *     ├── architecture.md       # 可选静态文件（覆盖内置渲染）
 *     └── ...
 *
 * template.yml 格式：
 *   name: default
 *   description: 默认 init 渲染模板
 *   version: "1.0"
 *   outputs:
 *     architecture: default       # 用内置扫描渲染器
 *     tech-stack: default
 *     api: file:./api.md          # 用模板目录下静态文件
 *     business: omit              # 不输出该文件
 *     ...
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { getXSpecRoot, writeYAML, writeMarkdown } from '../utils.js';
import {
  KNOWLEDGE_INDEX_KEYS,
  KNOWLEDGE_INDEX_FILENAMES,
  KNOWLEDGE_INDEX_TITLES,
  BUILTIN_RENDERERS,
  type ProjectScanResult,
  type KnowledgeIndexKey,
} from './project-scanner.js';

// ─── 类型定义 ───

/** 单个索引的渲染策略 */
export type OutputStrategy =
  | 'default'                       // 用内置扫描渲染器
  | 'omit'                          // 不输出该文件
  | `file:${string}`;               // 用模板目录下的静态文件（相对路径）

export interface InitTemplateManifest {
  name: string;
  description: string;
  version: string;
  /** 各索引的渲染策略，未列出的 key 默认为 'default' */
  outputs: Partial<Record<KnowledgeIndexKey, OutputStrategy>>;
}

export interface RenderedKnowledgeFile {
  key: KnowledgeIndexKey;
  filename: string;
  content: string;
  source: 'builtin' | 'static-file' | 'omitted';
}

export interface InitTemplateInfo {
  name: string;
  description: string;
  version: string;
  dir: string;
  outputCount: number;
  omittedCount: number;
  staticFileCount: number;
}

// ─── 默认模板内容 ───

export const DEFAULT_TEMPLATE_NAME = 'default';

/** 默认模板的 template.yml 内容 */
export const DEFAULT_TEMPLATE_MANIFEST: InitTemplateManifest = {
  name: DEFAULT_TEMPLATE_NAME,
  description: '默认 init 渲染模板（详细索引，自动扫描填充）',
  version: '1.0',
  outputs: {
    architecture: 'default',
    'tech-stack': 'default',
    api: 'default',
    business: 'default',
    schema: 'default',
    'class-index': 'default',
    sdk: 'default',
  },
};

/** 默认模板附带的 README.md（解释模板机制） */
const DEFAULT_TEMPLATE_README = `# Init 渲染模板：default

本模板控制 \`x-spec init\` 时 7 个 knowledge 索引文件的渲染策略。

## template.yml 配置

\`\`\`yaml
outputs:
  architecture: default        # 用内置扫描渲染器（基于 project-scanner.ts）
  tech-stack: default
  api: default
  business: default
  schema: default
  class-index: default
  sdk: default
\`\`\`

## 策略说明

| 策略 | 含义 |
|------|------|
| \`default\` | 使用内置扫描渲染器，自动填充扫描结果 |
| \`file:./xxx.md\` | 使用模板目录下的静态 markdown 文件（不做替换） |
| \`omit\` | 不输出该索引文件 |

## 自定义模板

1. 复制本目录：\`x-spec/templates/init/<新名称>/\`
2. 修改 \`template.yml\` 中的 \`outputs\` 策略
3. 若某索引用 \`file:./xxx.md\`，在目录下放对应静态文件
4. 初始化时指定：\`x-spec init --init-template <新名称>\`

## 支持的索引 key

| key | 文件名 | 中文标题 |
|-----|--------|---------|
${KNOWLEDGE_INDEX_KEYS.map(k => `| \`${k}\` | \`${KNOWLEDGE_INDEX_FILENAMES[k]}\` | ${KNOWLEDGE_INDEX_TITLES[k]} |`).join('\n')}
`;

// ─── 引擎实现 ───

export class InitTemplateEngine {
  private readonly projectRoot: string;
  private readonly templatesDir: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.templatesDir = path.join(getXSpecRoot(projectRoot), 'templates', 'init');
  }

  /** 模板根目录（绝对路径） */
  getTemplatesDir(): string {
    return this.templatesDir;
  }

  /** 列出所有可用模板 */
  listTemplates(): InitTemplateInfo[] {
    if (!fs.existsSync(this.templatesDir)) return [];
    const result: InitTemplateInfo[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.templatesDir, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = this.tryLoadManifest(entry.name);
      if (!manifest) continue;
      result.push(this.toInfo(entry.name, manifest));
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 加载指定模板的清单 */
  loadManifest(name: string): InitTemplateManifest {
    const manifest = this.tryLoadManifest(name);
    if (!manifest) {
      throw new Error(`Init 渲染模板不存在: ${name}（查找路径: ${this.templatesDir}）`);
    }
    return manifest;
  }

  /** 判断模板是否存在 */
  exists(name: string): boolean {
    return this.tryLoadManifest(name) !== null;
  }

  /** 渲染所有 knowledge 索引文件，返回内容列表（不写盘） */
  renderAll(name: string, scan: ProjectScanResult): RenderedKnowledgeFile[] {
    const manifest = this.loadManifest(name);
    const templateDir = path.join(this.templatesDir, name);
    const results: RenderedKnowledgeFile[] = [];

    for (const key of KNOWLEDGE_INDEX_KEYS) {
      const strategy = manifest.outputs[key] ?? 'default';
      const filename = KNOWLEDGE_INDEX_FILENAMES[key];

      if (strategy === 'omit') {
        results.push({ key, filename, content: '', source: 'omitted' });
        continue;
      }

      if (strategy.startsWith('file:')) {
        const relPath = strategy.slice('file:'.length).trim();
        const fullPath = path.resolve(templateDir, relPath);
        if (!fs.existsSync(fullPath)) {
          // 找不到静态文件时回退到内置渲染，避免 init 失败
          results.push({
            key,
            filename,
            content: BUILTIN_RENDERERS[key](scan),
            source: 'builtin',
          });
          continue;
        }
        const content = fs.readFileSync(fullPath, 'utf-8');
        results.push({ key, filename, content, source: 'static-file' });
        continue;
      }

      // default
      results.push({
        key,
        filename,
        content: BUILTIN_RENDERERS[key](scan),
        source: 'builtin',
      });
    }

    return results;
  }

  /** 渲染并写入 knowledge 目录 */
  renderAndWrite(name: string, scan: ProjectScanResult, knowledgeDir: string): {
    written: string[];
    omitted: string[];
    fallbacks: Array<{ key: string; reason: string }>;
  } {
    const files = this.renderAll(name, scan);
    const written: string[] = [];
    const omitted: string[] = [];
    const fallbacks: Array<{ key: string; reason: string }> = [];

    for (const f of files) {
      if (f.source === 'omitted') {
        omitted.push(f.filename);
        continue;
      }
      // 若静态文件配置但实际回退到 builtin，记录告警
      const manifest = this.loadManifest(name);
      const strategy = manifest.outputs[f.key] ?? 'default';
      if (strategy.startsWith('file:') && f.source === 'builtin') {
        fallbacks.push({ key: f.key, reason: `静态文件 ${strategy.slice(5)} 不存在，已回退到内置渲染` });
      }
      writeMarkdown(path.join(knowledgeDir, f.filename), f.content);
      written.push(f.filename);
    }

    return { written, omitted, fallbacks };
  }

  /** 创建新模板（从默认模板派生） */
  createTemplate(name: string, description?: string): InitTemplateManifest {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
      throw new Error('模板名称只能包含字母、数字、连字符，且以字母或数字开头');
    }
    const targetDir = path.join(this.templatesDir, name);
    if (fs.existsSync(targetDir)) {
      throw new Error(`模板已存在: ${name}（路径: ${targetDir}）`);
    }
    fs.mkdirSync(targetDir, { recursive: true });

    const manifest: InitTemplateManifest = {
      name,
      description: description || `自定义 init 渲染模板（从 default 派生）`,
      version: '1.0',
      outputs: { ...DEFAULT_TEMPLATE_MANIFEST.outputs },
    };
    writeYAML(path.join(targetDir, 'template.yml'), manifest);
    writeMarkdown(path.join(targetDir, 'README.md'), DEFAULT_TEMPLATE_README.replace(/: default/, `: ${name}`).replace('default', name));

    return manifest;
  }

  /** 确保默认模板存在（init 时自动创建脚手架） */
  ensureDefaultTemplate(): void {
    fs.mkdirSync(this.templatesDir, { recursive: true });
    if (this.exists(DEFAULT_TEMPLATE_NAME)) return;
    const defaultDir = path.join(this.templatesDir, DEFAULT_TEMPLATE_NAME);
    fs.mkdirSync(defaultDir, { recursive: true });
    writeYAML(path.join(defaultDir, 'template.yml'), DEFAULT_TEMPLATE_MANIFEST);
    writeMarkdown(path.join(defaultDir, 'README.md'), DEFAULT_TEMPLATE_README);
  }

  /** 查看模板详情 */
  showTemplate(name: string): { manifest: InitTemplateInfo; outputs: Array<{ key: KnowledgeIndexKey; filename: string; title: string; strategy: OutputStrategy }> } {
    const manifest = this.loadManifest(name);
    const info = this.toInfo(name, manifest);
    const outputs = KNOWLEDGE_INDEX_KEYS.map(k => ({
      key: k,
      filename: KNOWLEDGE_INDEX_FILENAMES[k],
      title: KNOWLEDGE_INDEX_TITLES[k],
      strategy: manifest.outputs[k] ?? 'default',
    }));
    return { manifest: info, outputs };
  }

  // ─── 内部方法 ───

  private tryLoadManifest(name: string): InitTemplateManifest | null {
    const manifestPath = path.join(this.templatesDir, name, 'template.yml');
    if (!fs.existsSync(manifestPath)) return null;
    try {
      const raw = YAML.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (!raw || typeof raw !== 'object') return null;
      return this.normalizeManifest(raw, name);
    } catch {
      return null;
    }
  }

  private normalizeManifest(raw: any, fallbackName: string): InitTemplateManifest {
    const outputs: InitTemplateManifest['outputs'] = {};
    if (raw.outputs && typeof raw.outputs === 'object') {
      for (const key of KNOWLEDGE_INDEX_KEYS) {
        const v = raw.outputs[key];
        if (v === 'default' || v === 'omit' || (typeof v === 'string' && v.startsWith('file:'))) {
          outputs[key] = v;
        }
      }
    }
    return {
      name: typeof raw.name === 'string' ? raw.name : fallbackName,
      description: typeof raw.description === 'string' ? raw.description : '',
      version: typeof raw.version === 'string' ? raw.version : '1.0',
      outputs,
    };
  }

  private toInfo(name: string, manifest: InitTemplateManifest): InitTemplateInfo {
    const dir = path.join(this.templatesDir, name);
    let staticFileCount = 0;
    let omittedCount = 0;
    let outputCount = 0;
    for (const key of KNOWLEDGE_INDEX_KEYS) {
      const s = manifest.outputs[key] ?? 'default';
      if (s === 'omit') omittedCount++;
      else if (s.startsWith('file:')) {
        staticFileCount++;
        const full = path.resolve(dir, s.slice(5).trim());
        if (fs.existsSync(full)) outputCount++;
      } else {
        outputCount++;
      }
    }
    return {
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      dir: path.relative(this.projectRoot, dir).replace(/\\/g, '/'),
      outputCount,
      omittedCount,
      staticFileCount,
    };
  }
}
