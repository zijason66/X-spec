/**
 * MCP 知识源注入引擎
 *
 * 职责：
 * 1. 读取 x-spec.yml 中的 mcp-knowledge 配置
 * 2. 启动 MCP 服务器进程（stdio transport）
 * 3. 调用指定 tool 获取知识内容
 * 4. 将结果持久化到 knowledge/ 目录
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import type { McpKnowledgeSource } from '../types.js';

export class McpKnowledgeEngine {
  private readonly knowledgeDir: string;
  private readonly sources: McpKnowledgeSource[];
  private readonly enabled: boolean;

  constructor(knowledgeDir: string, config?: { enabled: boolean; sources: McpKnowledgeSource[] }) {
    this.knowledgeDir = knowledgeDir;
    this.enabled = config?.enabled ?? false;
    this.sources = config?.sources ?? [];
  }

  /** 执行所有 autoInject=true 的知识源注入 */
  async injectAll(): Promise<Record<string, string>> {
    if (!this.enabled || this.sources.length === 0) {
      console.log(chalk.gray('  MCP知识源: 未配置或未启用'));
      return {};
    }

    const autoSources = this.sources.filter(s => s.autoInject !== false);
    if (autoSources.length === 0) {
      console.log(chalk.gray('  MCP知识源: 无自动注入的知识源'));
      return {};
    }

    const results: Record<string, string> = {};

    for (const source of autoSources) {
      try {
        results[source.name] = await this.injectOne(source);
      } catch (e: any) {
        console.log(chalk.yellow(`  ⚠ MCP知识源 [${source.name}] 注入失败: ${e.message}`));
        results[source.name] = `> ⚠ 知识源 ${source.name} 注入失败: ${e.message}`;
      }
    }

    return results;
  }

  /** 执行指定名称的知识源注入 */
  async injectByName(name: string): Promise<string> {
    const source = this.sources.find(s => s.name === name);
    if (!source) throw new Error(`未找到 MCP 知识源: ${name}`);
    return this.injectOne(source);
  }

  /** 列出所有已配置的知识源 */
  listSources(): { name: string; type: string; description: string; autoInject: boolean }[] {
    return this.sources.map(s => ({
      name: s.name,
      type: s.type,
      description: s.description,
      autoInject: s.autoInject !== false,
    }));
  }

  // ─── 内部方法 ───

  private async injectOne(source: McpKnowledgeSource): Promise<string> {
    console.log(chalk.cyan(`  ⟳ MCP知识源 [${source.name}] 开始注入...`));

    const transport = new StdioClientTransport({
      command: source.server.command,
      args: source.server.args,
      env: source.server.env as Record<string, string> | undefined,
    });

    const client = new Client(
      { name: `x-spec-mcp-${source.name}`, version: '1.0.0' },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);

      // 调用指定 tool
      const toolParams = this.resolveParams(source.toolParams);
      const result = await client.callTool({ name: source.tool, arguments: toolParams });

      // 提取文本内容
      const content = this.extractTextContent(result);

      // 写入 knowledge 目录
      const outputFile = path.join(this.knowledgeDir, source.outputFile);
      const header = this.buildHeader(source);
      const fullContent = `${header}${content}`;

      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      fs.writeFileSync(outputFile, fullContent, 'utf-8');

      console.log(chalk.green(`  ✓ MCP知识源 [${source.name}] → knowledge/${source.outputFile}`));
      return fullContent;
    } finally {
      await client.close();
    }
  }

  /** 解析参数模板中的变量 */
  private resolveParams(params?: Record<string, string>): Record<string, unknown> {
    if (!params) return {};
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      resolved[key] = value
        .replace('{{project-root}}', process.cwd())
        .replace('{{timestamp}}', new Date().toISOString());
    }
    return resolved;
  }

  /** 从 MCP tool result 中提取文本 */
  private extractTextContent(result: any): string {
    if (!result?.content) return '> MCP 返回内容为空';
    if (typeof result.content === 'string') return result.content;
    if (Array.isArray(result.content)) {
      return result.content
        .map((item: any) => {
          if (typeof item === 'string') return item;
          if (item.type === 'text') return item.text;
          return JSON.stringify(item);
        })
        .join('\n');
    }
    return JSON.stringify(result.content, null, 2);
  }

  /** 生成知识文件的头部信息 */
  private buildHeader(source: McpKnowledgeSource): string {
    const typeLabel: Record<string, string> = {
      'code-graph': '代码图谱',
      'knowledge-base': '知识库',
      'custom': '自定义',
    };
    const lines = [
      `# ${source.name}`,
      '',
      `> 类型: ${typeLabel[source.type] || source.type} · 描述: ${source.description}`,
      `> 数据源: MCP tool \`${source.tool}\``,
    ];
    if (source.prompt) {
      lines.push(`> 提示词: ${source.prompt}`);
    }
    lines.push('', '---', '');
    return lines.join('\n');
  }
}
