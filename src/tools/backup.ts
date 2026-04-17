import type Database from "better-sqlite3";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ExportHubSchema, ImportHubSchema } from "../types.js";
import type { ToolResult } from "../types.js";
import { exportHub, importHub } from "../db.js";

export function exportHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = ExportHubSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const data = exportHub(db, {
      include_deleted: parsed.data.include_deleted,
    });

    const filePath = resolve(
      parsed.data.file_path ?? "./dev-memory-export.json"
    );
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");

    return {
      content: [
        {
          type: "text",
          text: `Exported hub to ${filePath}: ${data.projects.length} projects, ${data.contexts.length} contexts, ${data.sessions.length} sessions.`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[export_hub] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in export_hub: ${message}` },
      ],
      isError: true,
    };
  }
}

export function importHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = ImportHubSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const filePath = resolve(parsed.data.file_path);
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `Could not read file ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `File ${filePath} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }

    const result = importHub(db, data, parsed.data.mode);
    return {
      content: [
        {
          type: "text",
          text: `Imported from ${filePath} (mode=${parsed.data.mode}): ${result.projects} projects, ${result.contexts} contexts, ${result.sessions} sessions.`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[import_hub] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in import_hub: ${message}` },
      ],
      isError: true,
    };
  }
}
