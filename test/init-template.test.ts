import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { InitTemplateEngine, DEFAULT_TEMPLATE_MANIFEST, DEFAULT_TEMPLATE_NAME } from '../src/core/init-template-engine';
import { scanProject } from '../src/core/project-scanner';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'x-spec-itpl-'));
}

function writeFile(dir: string, relPath: string, content: string): void {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

describe('init-template-engine', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = createTempDir(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  describe('ensureDefaultTemplate', () => {
    it('首次调用创建 default 模板脚手架', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();

      const templateDir = path.join(tempDir, 'x-spec', 'templates', 'init', 'default');
      expect(fs.existsSync(path.join(templateDir, 'template.yml'))).toBe(true);
      expect(fs.existsSync(path.join(templateDir, 'README.md'))).toBe(true);
    });

    it('已存在时不重复覆盖', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();
      // 手动修改 README，确认第二次调用不覆盖
      const readmePath = path.join(tempDir, 'x-spec', 'templates', 'init', 'default', 'README.md');
      fs.writeFileSync(readmePath, 'CUSTOM', 'utf-8');

      engine.ensureDefaultTemplate();
      expect(fs.readFileSync(readmePath, 'utf-8')).toBe('CUSTOM');
    });
  });

  describe('loadManifest / exists', () => {
    it('加载默认模板清单', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();

      expect(engine.exists(DEFAULT_TEMPLATE_NAME)).toBe(true);
      const manifest = engine.loadManifest(DEFAULT_TEMPLATE_NAME);
      expect(manifest.name).toBe(DEFAULT_TEMPLATE_NAME);
      expect(manifest.outputs.architecture).toBe('default');
      expect(manifest.outputs['tech-stack']).toBe('default');
      expect(manifest.outputs.sdk).toBe('default');
    });

    it('不存在时抛出错误', () => {
      const engine = new InitTemplateEngine(tempDir);
      expect(() => engine.loadManifest('nonexistent')).toThrow(/不存在/);
      expect(engine.exists('nonexistent')).toBe(false);
    });
  });

  describe('listTemplates', () => {
    it('列出已创建的模板', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();
      engine.createTemplate('custom-a');
      engine.createTemplate('custom-b');

      const list = engine.listTemplates();
      const names = list.map(t => t.name);
      expect(names).toContain(DEFAULT_TEMPLATE_NAME);
      expect(names).toContain('custom-a');
      expect(names).toContain('custom-b');
      expect(list.length).toBe(3);
    });

    it('未初始化时返回空数组', () => {
      const engine = new InitTemplateEngine(tempDir);
      expect(engine.listTemplates()).toEqual([]);
    });
  });

  describe('createTemplate', () => {
    it('从默认模板派生新模板', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();
      const manifest = engine.createTemplate('my-tpl', '我的自定义模板');

      expect(manifest.name).toBe('my-tpl');
      expect(manifest.description).toBe('我的自定义模板');
      expect(manifest.outputs.architecture).toBe('default');

      const templateDir = path.join(tempDir, 'x-spec', 'templates', 'init', 'my-tpl');
      expect(fs.existsSync(path.join(templateDir, 'template.yml'))).toBe(true);
      expect(fs.existsSync(path.join(templateDir, 'README.md'))).toBe(true);
    });

    it('拒绝非法模板名', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();
      expect(() => engine.createTemplate('My Template!')).toThrow();
      expect(() => engine.createTemplate('')).toThrow();
    });

    it('拒绝重名模板', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();
      engine.createTemplate('dup');
      expect(() => engine.createTemplate('dup')).toThrow(/已存在/);
    });
  });

  describe('renderAll - 策略调度', () => {
    let scan: ReturnType<typeof scanProject>;

    beforeEach(() => {
      writeFile(tempDir, 'pom.xml', `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.demo</groupId>
  <artifactId>Demo</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.2.0</version>
    </dependency>
  </dependencies>
</project>`);
      writeFile(tempDir, 'src/main/java/com/demo/App.java', `package com.demo;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
@SpringBootApplication
public class App { public static void main(String[] a){} }`);
      scan = scanProject(tempDir);
    });

    it('default 策略使用内置渲染器', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();
      const files = engine.renderAll(DEFAULT_TEMPLATE_NAME, scan);

      expect(files.length).toBe(7);
      const arch = files.find(f => f.key === 'architecture');
      expect(arch?.source).toBe('builtin');
      expect(arch?.content).toContain('java-maven');
      expect(arch?.content).toContain('App');
    });

    it('omit 策略跳过输出', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();
      engine.createTemplate('omit-test');
      // 修改 template.yml 把 sdk 设为 omit
      const tplDir = path.join(tempDir, 'x-spec', 'templates', 'init', 'omit-test');
      const ymlContent = fs.readFileSync(path.join(tplDir, 'template.yml'), 'utf-8')
        .replace('sdk: default', 'sdk: omit');
      fs.writeFileSync(path.join(tplDir, 'template.yml'), ymlContent, 'utf-8');

      const files = engine.renderAll('omit-test', scan);
      const sdk = files.find(f => f.key === 'sdk');
      expect(sdk?.source).toBe('omitted');
      expect(sdk?.content).toBe('');
    });

    it('file 策略使用静态文件', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();
      engine.createTemplate('file-test');
      const tplDir = path.join(tempDir, 'x-spec', 'templates', 'init', 'file-test');

      // 放一个静态 api.md 文件
      fs.writeFileSync(path.join(tplDir, 'api.md'), '# 自定义 API 文档\n\n这是静态内容。', 'utf-8');
      // 修改 template.yml
      const ymlContent = fs.readFileSync(path.join(tplDir, 'template.yml'), 'utf-8')
        .replace('api: default', 'api: file:./api.md');
      fs.writeFileSync(path.join(tplDir, 'template.yml'), ymlContent, 'utf-8');

      const files = engine.renderAll('file-test', scan);
      const api = files.find(f => f.key === 'api');
      expect(api?.source).toBe('static-file');
      expect(api?.content).toContain('自定义 API 文档');
      expect(api?.content).not.toContain('外部 API 依赖');
    });

    it('file 策略找不到静态文件时回退到内置渲染', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();
      engine.createTemplate('fallback-test');
      const tplDir = path.join(tempDir, 'x-spec', 'templates', 'init', 'fallback-test');
      // 配置 file:./missing.md 但不创建该文件
      const ymlContent = fs.readFileSync(path.join(tplDir, 'template.yml'), 'utf-8')
        .replace('api: default', 'api: file:./missing.md');
      fs.writeFileSync(path.join(tplDir, 'template.yml'), ymlContent, 'utf-8');

      const files = engine.renderAll('fallback-test', scan);
      const api = files.find(f => f.key === 'api');
      expect(api?.source).toBe('builtin');
    });
  });

  describe('renderAndWrite - 写盘', () => {
    let scan: ReturnType<typeof scanProject>;

    beforeEach(() => {
      writeFile(tempDir, 'pom.xml', '<project><modelVersion>4.0.0</modelVersion></project>');
      scan = scanProject(tempDir);
    });

    it('将渲染结果写入 knowledge 目录', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();
      const knowledgeDir = path.join(tempDir, 'x-spec', 'knowledge');
      fs.mkdirSync(knowledgeDir, { recursive: true });

      const result = engine.renderAndWrite(DEFAULT_TEMPLATE_NAME, scan, knowledgeDir);
      expect(result.written.length).toBe(7);
      expect(result.omitted.length).toBe(0);
      expect(result.fallbacks.length).toBe(0);
      expect(fs.existsSync(path.join(knowledgeDir, 'architecture.md'))).toBe(true);
      expect(fs.existsSync(path.join(knowledgeDir, 'sdk.md'))).toBe(true);
    });

    it('omit 的文件不写入', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();
      engine.createTemplate('omit-write');
      const tplDir = path.join(tempDir, 'x-spec', 'templates', 'init', 'omit-write');
      const ymlContent = fs.readFileSync(path.join(tplDir, 'template.yml'), 'utf-8')
        .replace('sdk: default', 'sdk: omit');
      fs.writeFileSync(path.join(tplDir, 'template.yml'), ymlContent, 'utf-8');

      const knowledgeDir = path.join(tempDir, 'x-spec', 'knowledge');
      fs.mkdirSync(knowledgeDir, { recursive: true });

      const result = engine.renderAndWrite('omit-write', scan, knowledgeDir);
      expect(result.written).not.toContain('sdk.md');
      expect(result.omitted).toContain('sdk.md');
      expect(fs.existsSync(path.join(knowledgeDir, 'sdk.md'))).toBe(false);
    });

    it('file 策略回退时记录 fallback 告警', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();
      engine.createTemplate('fb-write');
      const tplDir = path.join(tempDir, 'x-spec', 'templates', 'init', 'fb-write');
      const ymlContent = fs.readFileSync(path.join(tplDir, 'template.yml'), 'utf-8')
        .replace('api: default', 'api: file:./missing.md');
      fs.writeFileSync(path.join(tplDir, 'template.yml'), ymlContent, 'utf-8');

      const knowledgeDir = path.join(tempDir, 'x-spec', 'knowledge');
      fs.mkdirSync(knowledgeDir, { recursive: true });

      const result = engine.renderAndWrite('fb-write', scan, knowledgeDir);
      expect(result.fallbacks.length).toBe(1);
      expect(result.fallbacks[0].key).toBe('api');
      expect(result.fallbacks[0].reason).toContain('missing.md');
    });
  });

  describe('showTemplate', () => {
    it('返回模板详情和 outputs 策略', () => {
      const engine = new InitTemplateEngine(tempDir);
      engine.ensureDefaultTemplate();
      const { manifest, outputs } = engine.showTemplate(DEFAULT_TEMPLATE_NAME);

      expect(manifest.name).toBe(DEFAULT_TEMPLATE_NAME);
      expect(outputs.length).toBe(7);
      const arch = outputs.find(o => o.key === 'architecture');
      expect(arch?.strategy).toBe('default');
      expect(arch?.filename).toBe('architecture.md');
      expect(arch?.title).toBe('代码架构索引');
    });
  });

  describe('常量导出', () => {
    it('DEFAULT_TEMPLATE_MANIFEST 包含全部 7 个索引的 default 策略', () => {
      const keys = Object.keys(DEFAULT_TEMPLATE_MANIFEST.outputs);
      expect(keys.length).toBe(7);
      expect(keys).toContain('architecture');
      expect(keys).toContain('tech-stack');
      expect(keys).toContain('api');
      expect(keys).toContain('business');
      expect(keys).toContain('schema');
      expect(keys).toContain('class-index');
      expect(keys).toContain('sdk');
      for (const v of Object.values(DEFAULT_TEMPLATE_MANIFEST.outputs)) {
        expect(v).toBe('default');
      }
    });
  });
});
