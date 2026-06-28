// =============================================================================
// AI Stats Hook Verification Demo
//   This file is intentionally committed via `git-ai checkpoint mock_ai`
//   so that git-ai authorship tracking tags these lines as AI-generated.
//   The pre-push hook should then collect stats showing ai_additions > 0.
// =============================================================================

// @ai-generated mock_ai
// Verification comment: this function is a placeholder for AI-generated code.
function calculateAiStats(commits) {
  // @ai-generated mock_ai
  // Aggregate per-commit stats into a summary object.
  const summary = {
    total_commits: commits.length,
    total_ai_additions: 0,
    total_human_additions: 0,
    total_unknown_additions: 0,
    by_tool: {},
  };

  // @ai-generated mock_ai
  // Verification: iterate and accumulate.
  for (const c of commits) {
    summary.total_ai_additions += c.ai_additions || 0;
    summary.total_human_additions += c.human_additions || 0;
    summary.total_unknown_additions += c.unknown_additions || 0;
    for (const [tool, lines] of Object.entries(c.tool_model_breakdown || {})) {
      summary.by_tool[tool] = (summary.by_tool[tool] || 0) + lines;
    }
  }

  return summary;
}

// @ai-generated mock_ai
// Verification comment: export for downstream consumers.
module.exports = { calculateAiStats };
