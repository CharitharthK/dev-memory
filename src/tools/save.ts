import type Database from "better-sqlite3";
import {
  SaveContextSchema,
  UpdateContextSchema,
  DeleteContextSchema,
} from "../types.js";
import type { ToolResult } from "../types.js";
import { saveContext, updateContext, deleteContext } from "../db.js";

export function saveHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = SaveContextSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const newId = saveContext(db, parsed.data);

    return {
      content: [
        {
          type: "text",
          text: `Context saved with id ${newId} in project "${parsed.data.project_name}".`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[save_context] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in save_context: ${message}` },
      ],
      isError: true,
    };
  }
}

export function updateHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = UpdateContextSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const updated = updateContext(db, parsed.data);

    if (!updated) {
      return {
        content: [
          {
            type: "text",
            text: `Context entry with id ${parsed.data.id} was not found.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Context entry ${parsed.data.id} updated successfully.`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[update_context] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in update_context: ${message}` },
      ],
      isError: true,
    };
  }
}

export function deleteHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = DeleteContextSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const deleted = deleteContext(db, parsed.data.id);

    if (!deleted) {
      return {
        content: [
          {
            type: "text",
            text: `Context entry with id ${parsed.data.id} was not found.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Context entry ${parsed.data.id} deleted successfully.`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[delete_context] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in delete_context: ${message}` },
      ],
      isError: true,
    };
  }
}
