import type Database from "better-sqlite3";
import {
  SearchContextSchema,
  GetContextSchema,
} from "../types.js";
import type { ToolResult, ContextSummary } from "../types.js";
import { searchContexts, getContextById } from "../db.js";

function formatSummary(row: ContextSummary): string {
  return [
    `[id:${row.id}] [${row.project_name}] ${row.title}`,
    `  Category: ${row.category} | Importance: ${row.importance} | Used: ${row.times_used}x | Tags: ${row.tags || "none"}`,
    `  ${row.preview}`,
  ].join("\n");
}

export function searchHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = SearchContextSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const { query, category, project_name, technology, limit } = parsed.data;

    if (!query && !technology) {
      return {
        content: [
          {
            type: "text",
            text: "Provide at least a query or technology filter.",
          },
        ],
        isError: true,
      };
    }

    const results = searchContexts(db, {
      query,
      category,
      project_name,
      technology,
      limit,
    });

    if (results.length === 0) {
      const target = query
        ? `query "${query}"`
        : `technology "${technology}"`;
      return {
        content: [
          { type: "text", text: `No results found for ${target}.` },
        ],
      };
    }

    const formatted = results.map(formatSummary).join("\n\n");
    return {
      content: [
        {
          type: "text",
          text: `Found ${results.length} result(s). Use get_context(id) for full content.\n\n${formatted}`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[search_context] Error:", err);
    return {
      content: [
        {
          type: "text",
          text: `Error in search_context: ${message}`,
        },
      ],
      isError: true,
    };
  }
}

export function getContextHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = GetContextSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const entry = getContextById(db, parsed.data.id);

    if (!entry) {
      return {
        content: [
          {
            type: "text",
            text: `Context entry with id ${parsed.data.id} was not found.`,
          },
        ],
      };
    }

    const lines = [
      `[${entry.project_name}] ${entry.title}`,
      `Category: ${entry.category} | Importance: ${entry.importance} | Used: ${entry.times_used}x`,
      `Tags: ${entry.tags || "none"} | Language: ${entry.language || "none"} | File: ${entry.file_path || "none"}`,
      `Created: ${entry.created_at} | Updated: ${entry.updated_at}`,
      "",
      entry.content,
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[get_context] Error:", err);
    return {
      content: [
        {
          type: "text",
          text: `Error in get_context: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
