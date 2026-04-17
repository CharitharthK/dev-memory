import type Database from "better-sqlite3";
import { ListHistorySchema } from "../types.js";
import type { ToolResult } from "../types.js";
import { listContextHistory, getContextById } from "../db.js";

export function listHistoryHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = ListHistorySchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    // Confirm the context exists (include deleted so users can inspect
    // history of a soft-deleted entry before restoring).
    const current = getContextById(db, parsed.data.id, {
      include_deleted: true,
    });
    if (!current) {
      return {
        content: [
          {
            type: "text",
            text: `Context entry with id ${parsed.data.id} was not found.`,
          },
        ],
      };
    }

    const history = listContextHistory(db, parsed.data.id);

    if (history.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No edit history for [id:${parsed.data.id}] "${current.title}". The entry has never been modified.`,
          },
        ],
      };
    }

    const lines: string[] = [
      `Edit history for [id:${parsed.data.id}] "${current.title}" (${history.length} revision${history.length === 1 ? "" : "s"}):`,
      "",
    ];
    for (const h of history) {
      lines.push(
        `[${h.changed_at}] title="${h.title}" category=${h.category} importance=${h.importance} tags="${h.tags || "—"}"`
      );
      lines.push(
        "  " +
          (h.content.length > 180
            ? h.content.slice(0, 180) + "…"
            : h.content)
      );
      lines.push("");
    }
    lines.push(
      `Current: title="${current.title}" category=${current.category} importance=${current.importance}`
    );

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[list_history] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in list_history: ${message}` },
      ],
      isError: true,
    };
  }
}
