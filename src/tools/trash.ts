import type Database from "better-sqlite3";
import {
  RestoreContextSchema,
  PurgeContextSchema,
  EmptyTrashSchema,
} from "../types.js";
import type { ToolResult } from "../types.js";
import {
  restoreContext,
  purgeContext,
  purgeDeletedOlderThan,
  searchContexts,
} from "../db.js";

export function restoreHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = RestoreContextSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const ok = restoreContext(db, parsed.data.id);
    if (!ok) {
      return {
        content: [
          {
            type: "text",
            text: `No deleted entry found with id ${parsed.data.id}.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Context entry ${parsed.data.id} restored from trash.`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[restore_context] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in restore_context: ${message}` },
      ],
      isError: true,
    };
  }
}

export function purgeHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = PurgeContextSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const ok = purgeContext(db, parsed.data.id);
    if (!ok) {
      return {
        content: [
          {
            type: "text",
            text: `No entry found with id ${parsed.data.id}.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Context entry ${parsed.data.id} permanently deleted (including history).`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[purge_context] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in purge_context: ${message}` },
      ],
      isError: true,
    };
  }
}

export function emptyTrashHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = EmptyTrashSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const count = purgeDeletedOlderThan(db, parsed.data.older_than_days);
    return {
      content: [
        {
          type: "text",
          text: `Permanently removed ${count} entr${count === 1 ? "y" : "ies"} from the trash.`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[empty_trash] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in empty_trash: ${message}` },
      ],
      isError: true,
    };
  }
}

export function listTrashHandler(
  _params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    // Treat every category as a valid search vector; include_deleted
    // is what we really want. We pass category='' via fallback: use
    // a broad search by listing entries directly via searchContexts
    // with include_deleted and a category-free technology-free call.
    // searchContexts requires a search vector, so we fall back to a
    // direct SQL pull here for simplicity.
    const rows = db
      .prepare(
        `SELECT c.id, p.name AS project_name, c.title, c.category,
                c.tags, c.importance, c.times_used, c.deleted_at,
                substr(c.content, 1, 180) AS preview
         FROM contexts c
         JOIN projects p ON p.id = c.project_id
         WHERE c.deleted_at IS NOT NULL
         ORDER BY c.deleted_at DESC
         LIMIT 50`
      )
      .all() as Array<{
      id: number;
      project_name: string;
      title: string;
      category: string;
      tags: string;
      importance: number;
      times_used: number;
      deleted_at: string;
      preview: string;
    }>;

    if (rows.length === 0) {
      return {
        content: [{ type: "text", text: "The trash is empty." }],
      };
    }

    const formatted = rows
      .map(
        (r) =>
          `[id:${r.id}] [${r.project_name}] ${r.title}\n  deleted: ${r.deleted_at} | category: ${r.category}\n  ${r.preview}`
      )
      .join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: `${rows.length} entr${rows.length === 1 ? "y" : "ies"} in trash. Use restore_context(id) or purge_context(id).\n\n${formatted}`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[list_trash] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in list_trash: ${message}` },
      ],
      isError: true,
    };
  }
}

// Note: searchContexts is imported for potential future use and to keep
// the module self-contained if we move the inline SQL above.
void searchContexts;
