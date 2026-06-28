// =============================================================================
// AI Stats Hook Final Verification Demo
//   Committed via `git-ai checkpoint mock_ai` to tag lines as AI-generated.
//   The pre-push hook should collect stats with ai_additions > 0.
// =============================================================================

// @ai-generated mock_ai
// Verification: aggregate per-commit AI authorship stats.
function summarizeAiStats(commits) {
  // @ai-generated mock_ai
  // Verification: accumulate additions by category and tool.
  const summary = {
    total_commits: commits.length,
    total_ai_additions: 0,
    total_human_additions: 0,
    total_unknown_additions: 0,
    by_tool: {},
  };

  // @ai-generated mock_ai
  // Verification: iterate and fold each commit's stats into the summary.
  for (const c of commits) {
    summary.total_ai_additions += c.ai_additions || 0;
    summary.total_human_additions += c.human_additions || 0;
    summary.total_unknown_additions += c.unknown_additions || 0;
    for (const [tool, lines] of Object.entries(c.tool_model_breakdown || {})) {
      summary.by_tool[tool] = (summary.by_tool[tool] || 0) + (lines.ai_additions || 0);
    }
  }

  return summary;
}

// @ai-generated mock_ai
// Verification: export for downstream consumers.
module.exports = { summarizeAiStats };
