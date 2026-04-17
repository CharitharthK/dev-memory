import type Database from "better-sqlite3";
import { RelatedContextSchema } from "../types.js";
import type { ToolResult } from "../types.js";
import { findRelated, getContextById } from "../db.js";

export function relatedHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = RelatedContextSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    // Verify the seed exists and is not soft-deleted
    const seed = getContextById(db, parsed.data.id, { include_deleted: true });
    if (!seed || seed.deleted_at) {
      return {
        content: [
          {
            type: "text",
            text: `No live context found with id ${parsed.data.id}. (Soft-deleted entries have no related_context output; restore first.)`,
          },
        ],
      };
    }

    // getContextById above incremented times_used for the seed, which is
    // the wrong semantics for `related_context` — related doesn't mean
    // the seed itself was consumed. Undo that bump.
    db.prepare(
      "UPDATE contexts SET times_used = times_used - 1 WHERE id = ? AND times_used > 0"
    ).run(parsed.data.id);

    const results = findRelated(db, parsed.data.id, parsed.data.limit);
    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No related entries found for [id:${parsed.data.id}] "${seed.title}".`,
          },
        ],
      };
    }

    const formatted = results
      .map(
        (r) =>
          `[id:${r.id}] [${r.project_name}] ${r.title}\n  score: ${r.score} | category: ${r.category} | used: ${r.times_used}x | tags: ${r.tags || "none"}\n  ${r.preview}`
      )
      .join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: `Found ${results.length} related entr${results.length === 1 ? "y" : "ies"} to [id:${parsed.data.id}] "${seed.title}":\n\n${formatted}`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[related_context] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in related_context: ${message}` },
      ],
      isError: true,
    };
  }
}
