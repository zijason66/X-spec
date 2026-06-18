/**
 * 模板引擎 - 将原有代码仓库模板化处理
 *
 * 职责：
 * 1. 从现有代码提取可复用模板（变量占位符替换）
 * 2. 应用模板生成新代码（变量值替换）
 * 3. 管理模板清单和模板变量
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { TemplateManifest } from '../types.js';
import { getXSpecRoot, writeYAML } from '../utils.js';

export class TemplateEngine {
  private readonly templatesDir: string;

  constructor(projectRoot: string) {
    this.templatesDir = path.join(getXSpecRoot(projectRoot), 'templates');
  }

  /** 从现有代码提取模板 */
  extractTemplate(sourcePath: string, templateName: string, variables?: string): void {
    const source = path.resolve(sourcePath);
    if (!fs.existsSync(source)) throw new Error(`源代码路径不存在: ${source}`);

    const templateDir = path.join(this.templatesDir, templateName);
    fs.mkdirSync(templateDir, { recursive: true });

    const varList = new Set<string>();
    if (variables) variables.split(',').forEach(v => varList.add(v.trim()));

    if (fs.statSync(source).isDirectory()) {
      this.extractDirectory(source, templateDir, varList);
    } else {
      this.extractFile(source, templateDir, varList);
    }

    const manifest: TemplateManifest = {
      name: templateName,
      'source-path': sourcePath,
      variables: [...varList],
      'required-variables': [],
      'created-at': new Date().toISOString(),
      'file-patterns': [],
    };
    writeYAML(path.join(templateDir, 'manifest.yml'), manifest);
  }

  /** 应用模板生成代码 */
  applyTemplate(templateName: string, outputPath: string, variableValues: Record<string, string>): void {
    const templateDir = path.join(this.templatesDir, templateName);
    if (!fs.existsSync(templateDir)) throw new Error(`模板不存在: ${templateName}`);

    const manifestPath = path.join(templateDir, 'manifest.yml');
    if (!fs.existsSync(manifestPath)) throw new Error('模板清单不存在');

    const manifest = YAML.parse(fs.readFileSync(manifestPath, 'utf-8')) as TemplateManifest;
    for (const v of manifest['required-variables']) {
      if (!variableValues[v]) throw new Error(`缺少必要变量: ${v}`);
    }

    const output = path.resolve(outputPath);
    fs.mkdirSync(output, { recursive: true });
    this.applyTemplateDir(templateDir, output, variableValues);
  }

  /** 列出可用模板 */
  listTemplates(): TemplateManifest[] {
    if (!fs.existsSync(this.templatesDir)) return [];
    return fs.readdirSync(this.templatesDir)
      .filter(d => fs.statSync(path.join(this.templatesDir, d)).isDirectory())
      .filter(d => fs.existsSync(path.join(this.templatesDir, d, 'manifest.yml')))
      .map(d => {
        try {
          return YAML.parse(fs.readFileSync(path.join(this.templatesDir, d, 'manifest.yml'), 'utf-8')) as TemplateManifest;
        } catch { return null; }
      })
      .filter((m): m is TemplateManifest => m !== null);
  }

  // ─── 内部方法 ───

  private extractFile(source: string, templateDir: string, vars: Set<string>): void {
    const content = fs.readFileSync(source, 'utf-8');
    this.detectVariables(content, vars);
    fs.writeFileSync(path.join(templateDir, path.basename(source)), content, 'utf-8');
  }

  private extractDirectory(source: string, templateDir: string, vars: Set<string>): void {
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const srcPath = path.join(source, entry.name);
      const destPath = path.join(templateDir, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.extractDirectory(srcPath, destPath, vars);
      } else {
        const content = fs.readFileSync(srcPath, 'utf-8');
        this.detectVariables(content, vars);
        fs.writeFileSync(destPath, content, 'utf-8');
      }
    }
  }

  private detectVariables(content: string, vars: Set<string>): void {
    const camelCase = content.match(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g) || [];
    for (const token of camelCase) {
      vars.add(token.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase());
    }
    const templateVars = content.match(/\{\{([\w-]+)\}\}/g) || [];
    for (const tv of templateVars) {
      vars.add(tv.replace(/\{\{|\}\}/g, ''));
    }
  }

  private applyTemplateDir(templateDir: string, outputPath: string, vars: Record<string, string>): void {
    for (const entry of fs.readdirSync(templateDir, { withFileTypes: true })) {
      if (entry.name === 'manifest.yml') continue;
      const srcPath = path.join(templateDir, entry.name);
      const resolvedName = this.resolveVars(entry.name, vars);
      const destPath = path.join(outputPath, resolvedName);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.applyTemplateDir(srcPath, destPath, vars);
      } else {
        let content = fs.readFileSync(srcPath, 'utf-8');
        content = this.resolveVars(content, vars);
        fs.writeFileSync(destPath, content, 'utf-8');
      }
    }
  }

  private resolveVars(content: string, vars: Record<string, string>): string {
    let result = content;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(`{{${key}}}`, value);
    }
    return result;
  }
}
