/**
 * 规范渲染器 - 将规范模型渲染为Markdown格式
 */

import type { SpecFile, SpecDelta } from '../types.js';

export class SpecRenderer {
  /** 渲染规范文件为Markdown */
  render(spec: SpecFile): string {
    let md = `# ${spec.module} Specification\n\n`;
    md += `## Purpose\n${spec.purpose}\n\n`;

    for (const req of spec.requirements) {
      md += `### Requirement: ${req.name}\n`;
      md += `The system SHALL ${req.description}.\n\n`;

      for (const sc of req.scenarios) {
        md += `#### Scenario: ${sc.name}\n`;
        md += `- GIVEN ${sc.given}\n`;
        md += `- WHEN ${sc.when}\n`;
        md += `- THEN ${sc.then}\n`;
        for (const a of sc.and) md += `- AND ${a}\n`;
        md += '\n';
      }
    }

    return md;
  }

  /** 渲染规范增量为Diff格式Markdown */
  renderDelta(delta: SpecDelta): string {
    let md = `# Spec Delta: ${delta.specName}\n\n`;
    md += `**类型**: ${delta.type}\n\n`;

    for (const reqDelta of delta.requirementDeltas) {
      md += `## Requirement: ${reqDelta.requirementName}\n`;
      md += `**操作**: ${reqDelta.action}\n\n`;
      if (reqDelta.before) md += `### 变更前\n\`\`\`diff\n- ${reqDelta.before}\n\`\`\`\n\n`;
      if (reqDelta.after) md += `### 变更后\n\`\`\`diff\n+ ${reqDelta.after}\n\`\`\`\n\n`;

      for (const scDelta of reqDelta.scenarioDeltas) {
        md += `### Scenario: ${scDelta.scenarioName} [${scDelta.action}]\n`;
        if (scDelta.given) md += `- GIVEN ${scDelta.given}\n`;
        if (scDelta.when) md += `- WHEN ${scDelta.when}\n`;
        if (scDelta.then) md += `- THEN ${scDelta.then}\n`;
        md += '\n';
      }
    }

    return md;
  }
}
