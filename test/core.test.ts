import { describe, it, expect } from 'vitest';
import { SpecParser } from '../src/core/spec-parser.js';
import { SpecRenderer } from '../src/core/spec-renderer.js';
import { WorkflowEngine } from '../src/core/workflow-engine.js';
import type { SpecDelta, WorkflowTemplate } from '../src/types.js';

describe('SpecParser', () => {
  const parser = new SpecParser();

  it('should parse a complete spec file', () => {
    const content = `# User Auth Specification

## Purpose
定义用户认证的行为规范。

### Requirement: User login
The system SHALL authenticate users via username and password.

#### Scenario: Successful login
- GIVEN a registered user
- WHEN the user provides valid credentials
- THEN the system SHALL grant access
- AND redirect to the dashboard

### Requirement: Password reset
The system SHALL allow users to reset their password.

#### Scenario: Reset via email
- GIVEN a user with a registered email
- WHEN the user requests a password reset
- THEN the system SHALL send a reset link
`;

    const spec = parser.parseContent(content);
    expect(spec.module).toBe('User Auth');
    expect(spec.purpose).toContain('用户认证');
    expect(spec.requirements).toHaveLength(2);
    expect(spec.requirements[0].name).toBe('User login');
    expect(spec.requirements[0].scenarios).toHaveLength(1);
    expect(spec.requirements[0].scenarios[0].given).toBe('a registered user');
    expect(spec.requirements[0].scenarios[0].and).toHaveLength(1);
  });

  it('should handle spec without scenarios', () => {
    const spec = parser.parseContent(`# Test Spec\n\n## Purpose\nTest.\n\n### Requirement: Basic\nThe system SHALL work.`);
    expect(spec.requirements).toHaveLength(1);
    expect(spec.requirements[0].scenarios).toHaveLength(0);
  });
});

describe('SpecRenderer', () => {
  const renderer = new SpecRenderer();

  it('should render spec delta', () => {
    const delta: SpecDelta = {
      specName: 'user-auth',
      type: 'MODIFY',
      requirementDeltas: [{
        requirementName: 'Login',
        action: 'MODIFY',
        before: 'old behavior',
        after: 'new behavior',
        scenarioDeltas: [{
          scenarioName: 'Login flow',
          action: 'ADD',
          given: 'a user',
          when: 'login',
          then: 'success',
        }],
      }],
    };

    const md = renderer.renderDelta(delta);
    expect(md).toContain('Spec Delta: user-auth');
    expect(md).toContain('MODIFY');
    expect(md).toContain('- old behavior');
    expect(md).toContain('+ new behavior');
    expect(md).toContain('GIVEN a user');
  });
});

describe('WorkflowTemplate', () => {
  it('should define SDD standard template with correct stages', () => {
    const template: WorkflowTemplate = {
      name: 'sdd-standard',
      description: 'SDD规范驱动开发标准流程',
      version: '1.0',
      stages: [
        { name: 'knowledge', description: '注入项目知识上下文', command: 'knowledge', required: true, depends_on: [] },
        { name: 'propose', description: '发起变更提案', command: 'propose', required: true, depends_on: ['knowledge'] },
        { name: 'review', description: '审查提案文档', command: 'review', required: true, depends_on: ['propose'] },
        { name: 'implement', description: '执行编码实现', command: 'apply', required: true, depends_on: ['review'] },
        { name: 'verify', description: '验证实现一致性', command: 'verify', required: true, depends_on: ['implement'] },
        { name: 'archive', description: '归档已完成变更', command: 'archive', required: false, depends_on: ['verify'] },
      ],
    };

    expect(template.stages).toHaveLength(6);
    expect(template.stages[0].name).toBe('knowledge');
    expect(template.stages[0].depends_on).toHaveLength(0);
    expect(template.stages[1].depends_on).toContain('knowledge');
    expect(template.stages[5].required).toBe(false);
  });

  it('should define SDD quick template with fewer stages', () => {
    const template: WorkflowTemplate = {
      name: 'sdd-quick',
      description: 'SDD快速开发流程',
      version: '1.0',
      stages: [
        { name: 'propose', description: '发起变更提案', command: 'propose', required: true, depends_on: [] },
        { name: 'implement', description: '执行编码实现', command: 'apply', required: true, depends_on: ['propose'] },
        { name: 'verify', description: '验证实现一致性', command: 'verify', required: true, depends_on: ['implement'] },
        { name: 'archive', description: '归档已完成变更', command: 'archive', required: false, depends_on: ['verify'] },
      ],
    };

    expect(template.stages).toHaveLength(4);
    // quick template should not have knowledge stage
    expect(template.stages.find(s => s.name === 'knowledge')).toBeUndefined();
  });

  it('should validate stage dependencies are valid', () => {
    const template: WorkflowTemplate = {
      name: 'test',
      description: 'test',
      version: '1.0',
      stages: [
        { name: 'a', description: 'a', command: 'knowledge', required: true, depends_on: [] },
        { name: 'b', description: 'b', command: 'propose', required: true, depends_on: ['a'] },
        { name: 'c', description: 'c', command: 'apply', required: true, depends_on: ['b'] },
      ],
    };

    const stageNames = new Set(template.stages.map(s => s.name));
    for (const stage of template.stages) {
      for (const dep of stage.depends_on) {
        expect(stageNames.has(dep)).toBe(true);
      }
    }
  });
});
