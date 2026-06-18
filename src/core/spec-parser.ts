/**
 * 规范文件解析器 - 解析Markdown格式的OpenSpec规范文件
 *
 * 解析三要素：
 * - Purpose（目的）
 * - Requirements（需求，使用SHALL语义化关键字）
 * - Scenarios（场景，采用Given-When-Then模式）
 */

import type { SpecFile, Requirement, Scenario } from '../types.js';

export class SpecParser {
  /** 解析规范内容字符串 */
  parseContent(content: string): SpecFile {
    const spec: SpecFile = { module: '', purpose: '', requirements: [] };
    const lines = content.split('\n');

    let currentSection: string | null = null;
    let currentRequirement: Requirement | null = null;
    let currentScenario: Scenario | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
        spec.module = trimmed.substring(2).replace(' Specification', '').trim();
        currentSection = 'header';
        continue;
      }

      if (trimmed.startsWith('## Purpose')) { currentSection = 'purpose'; continue; }
      if (trimmed.startsWith('### Requirement:')) {
        currentSection = 'requirement';
        currentRequirement = { name: trimmed.substring('### Requirement:'.length).trim(), description: '', scenarios: [] };
        spec.requirements.push(currentRequirement);
        currentScenario = null;
        continue;
      }
      if (trimmed.startsWith('#### Scenario:')) {
        currentSection = 'scenario';
        currentScenario = { name: trimmed.substring('#### Scenario:'.length).trim(), given: '', when: '', then: '', and: [] };
        if (currentRequirement) currentRequirement.scenarios.push(currentScenario);
        continue;
      }

      if (currentSection === 'purpose' && trimmed && !trimmed.startsWith('#')) {
        spec.purpose += (spec.purpose ? '\n' : '') + trimmed;
      } else if (currentSection === 'requirement' && currentRequirement && trimmed && !trimmed.startsWith('#')) {
        currentRequirement.description += (currentRequirement.description ? ' ' : '') + trimmed;
      } else if (currentSection === 'scenario' && currentScenario) {
        this.parseScenarioLine(trimmed, currentScenario);
      }
    }

    return spec;
  }

  private parseScenarioLine(line: string, scenario: Scenario): void {
    if (line.startsWith('- GIVEN ')) scenario.given = line.substring('- GIVEN '.length);
    else if (line.startsWith('- WHEN ')) scenario.when = line.substring('- WHEN '.length);
    else if (line.startsWith('- THEN ')) scenario.then = line.substring('- THEN '.length);
    else if (line.startsWith('- AND ')) scenario.and.push(line.substring('- AND '.length));
  }
}
