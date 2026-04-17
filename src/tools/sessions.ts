import type Database from "better-sqlite3";
import { LogSessionSchema, SearchSessionsSchema } from "../types.js";
import type { ToolResult } from "../types.js";
import { logSession, searchSessions } from "../db.js";

export function logSessionHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = LogSessionSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const sessionId = logSession(db, parsed.data);

    return {
      content: [
        {
          type: "text",
          text: `Session logged with id ${sessionId} in project "${parsed.data.project_name}".`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[log_session] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in log_session: ${message}` },
      ],
      isError: true,
    };
  }
}

export function searchSessionsHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = SearchSessionsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const results = searchSessions(db, {
      query: parsed.data.query,
      project_name: parsed.data.project_name,
      limit: parsed.data.limit,
    });

    if (results.length === 0) {
      return {
        content: [
          { type: "text", text: "No sessions matched your filters." },
        ],
      };
    }

    const formatted = results
      .map(
        (s) =>
          `[id:${s.id}] [${s.project_name}] ${s.created_at}\n  summary: ${s.summary}\n  outcome: ${s.outcome || "—"} | contexts_used: ${s.contexts_used || "[]"}`
      )
      .join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: `Found ${results.length} session(s):\n\n${formatted}`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[search_sessions] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in search_sessions: ${message}` },
      ],
      isError: true,
    };
  }
}
