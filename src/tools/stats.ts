import type Database from "better-sqlite3";
import type { ToolResult, ContextSummary } from "../types.js";
import { getHubStats } from "../db.js";

export function getHubStatsHandler(
  _params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const stats = getHubStats(db);

    const lines: string[] = [
      `Hub Statistics`,
      `  Total Projects: ${stats.total_projects}`,
      `  Total Contexts: ${stats.total_contexts}`,
    ];

    const categoryEntries = Object.entries(stats.categories);
    if (categoryEntries.length > 0) {
      lines.push("", "Category Breakdown:");
      for (const [category, count] of categoryEntries) {
        lines.push(`  ${category}: ${count}`);
      }
    }

    const formatEntry = (e: ContextSummary) =>
      `  - [id:${e.id}] ${e.title} (used ${e.times_used}x, project: ${e.project_name})`;

    if (stats.top_used.length > 0) {
      lines.push("", "Top 5 Most Used:");
      for (const entry of stats.top_used) {
        lines.push(formatEntry(entry));
      }
    }

    if (stats.recent.length > 0) {
      lines.push("", "5 Most Recent:");
      for (const entry of stats.recent) {
        lines.push(formatEntry(entry));
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[get_hub_stats] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in get_hub_stats: ${message}` },
      ],
      isError: true,
    };
  }
}
