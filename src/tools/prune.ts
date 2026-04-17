import type Database from "better-sqlite3";
import { PruneUnusedSchema } from "../types.js";
import type { ToolResult } from "../types.js";
import { findUnused, deleteContext } from "../db.js";

export function pruneUnusedHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = PruneUnusedSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const candidates = findUnused(db, parsed.data.older_than_days);

    if (candidates.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No unused entries older than ${parsed.data.older_than_days} days.`,
          },
        ],
      };
    }

    if (!parsed.data.apply) {
      // Dry run — return the list for review
      const formatted = candidates
        .map(
          (r) =>
            `[id:${r.id}] [${r.project_name}] ${r.title}\n  category: ${r.category} | tags: ${r.tags || "none"}\n  ${r.preview}`
        )
        .join("\n\n");
      return {
        content: [
          {
            type: "text",
            text: `Found ${candidates.length} unused entr${candidates.length === 1 ? "y" : "ies"} (times_used=0, older than ${parsed.data.older_than_days} days).\n\nCall prune_unused({ apply: true }) to soft-delete them all, or delete individually.\n\n${formatted}`,
          },
        ],
      };
    }

    // Apply — soft-delete each
    let pruned = 0;
    const tx = db.transaction(() => {
      for (const c of candidates) {
        if (deleteContext(db, c.id)) pruned++;
      }
    });
    tx();

    return {
      content: [
        {
          type: "text",
          text: `Pruned ${pruned} unused entr${pruned === 1 ? "y" : "ies"} (moved to trash). Use restore_context(id) to recover any.`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[prune_unused] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in prune_unused: ${message}` },
      ],
      isError: true,
    };
  }
}
