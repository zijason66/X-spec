import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const CLI_PATH = path.resolve(import.meta.dirname, '..', 'src', 'index.ts');

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'x-spec-test-'));
}

describe('x-spec CLI', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = createTempDir(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  describe('init', () => {
    it('should create x-spec directory structure', () => {
      execSync(`npx tsx "${CLI_PATH}" init --path "${tempDir}"`, { stdio: 'pipe' });

      const xspecRoot = path.join(tempDir, 'x-spec');
      expect(fs.existsSync(path.join(xspecRoot, 'specs'))).toBe(true);
      expect(fs.existsSync(path.join(xspecRoot, 'changes'))).toBe(true);
      expect(fs.existsSync(path.join(xspecRoot, 'archive'))).toBe(true);
      expect(fs.existsSync(path.join(xspecRoot, 'workflows'))).toBe(true);
      expect(fs.existsSync(path.join(xspecRoot, 'templates'))).toBe(true);
      expect(fs.existsSync(path.join(xspecRoot, 'knowledge'))).toBe(true);
      expect(fs.existsSync(path.join(xspecRoot, 'x-spec.yml'))).toBe(true);
    });

    it('should create knowledge templates', () => {
      execSync(`npx tsx "${CLI_PATH}" init --path "${tempDir}"`, { stdio: 'pipe' });

      const knowledgeDir = path.join(tempDir, 'x-spec', 'knowledge');
      expect(fs.existsSync(path.join(knowledgeDir, 'business.md'))).toBe(true);
      expect(fs.existsSync(path.join(knowledgeDir, 'tech-stack.md'))).toBe(true);
      expect(fs.existsSync(path.join(knowledgeDir, 'api.md'))).toBe(true);
      expect(fs.existsSync(path.join(knowledgeDir, 'sdk.md'))).toBe(true);
    });

    it('should reject re-init without force', () => {
      execSync(`npx tsx "${CLI_PATH}" init --path "${tempDir}"`, { stdio: 'pipe' });
      expect(() => {
        execSync(`npx tsx "${CLI_PATH}" init --path "${tempDir}"`, { stdio: 'pipe' });
      }).toThrow();
    });
  });

  describe('propose', () => {
    it('should warn about missing knowledge', () => {
      execSync(`npx tsx "${CLI_PATH}" init --path "${tempDir}"`, { stdio: 'pipe' });
      expect(() => {
        execSync(`npx tsx "${CLI_PATH}" propose "test feature" --path "${tempDir}"`, { stdio: 'pipe' });
      }).toThrow();
    });

    it('should create change proposal with --skip-knowledge-check', () => {
      execSync(`npx tsx "${CLI_PATH}" init --path "${tempDir}"`, { stdio: 'pipe' });
      execSync(`npx tsx "${CLI_PATH}" propose "test feature" --path "${tempDir}" --skip-knowledge-check`, { stdio: 'pipe' });

      const changesDir = path.join(tempDir, 'x-spec', 'changes');
      const dirs = fs.readdirSync(changesDir).filter(d => fs.statSync(path.join(changesDir, d)).isDirectory());
      expect(dirs.length).toBeGreaterThan(0);

      const changeDir = path.join(changesDir, dirs[0]);
      expect(fs.existsSync(path.join(changeDir, 'proposal.md'))).toBe(true);
      expect(fs.existsSync(path.join(changeDir, 'design.md'))).toBe(true);
      expect(fs.existsSync(path.join(changeDir, 'tasks.md'))).toBe(true);
    });
  });

  describe('workflow', () => {
    it('should list workflows', () => {
      execSync(`npx tsx "${CLI_PATH}" init --path "${tempDir}"`, { stdio: 'pipe' });
      const output = execSync(`npx tsx "${CLI_PATH}" workflow list --path "${tempDir}"`, { encoding: 'utf-8' });
      expect(output).toContain('sdd-standard-flow');
    });

    it('should validate workflow', () => {
      execSync(`npx tsx "${CLI_PATH}" init --path "${tempDir}"`, { stdio: 'pipe' });
      const output = execSync(`npx tsx "${CLI_PATH}" workflow validate sdd-standard-flow --path "${tempDir}"`, { encoding: 'utf-8' });
      expect(output).toContain('验证通过');
    });
  });
});
