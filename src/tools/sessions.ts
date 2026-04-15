import type Database from "better-sqlite3";
import { LogSessionSchema } from "../types.js";
import type { ToolResult } from "../types.js";
import { logSession } from "../db.js";

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
