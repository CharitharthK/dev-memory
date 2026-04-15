import type Database from "better-sqlite3";
import { UpdateProjectSchema } from "../types.js";
import type { ToolResult, ProjectRow } from "../types.js";
import { listProjects, updateProject } from "../db.js";

function formatProject(row: ProjectRow): string {
  return [
    `${row.name}`,
    `  Tech Stack: ${row.tech_stack || "not set"}`,
    `  Description: ${row.description || "not set"}`,
    `  Contexts: ${row.context_count}`,
  ].join("\n");
}

export function listProjectsHandler(
  _params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const projects = listProjects(db);

    if (projects.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No projects found. Save a context entry to auto-create a project.",
          },
        ],
      };
    }

    const formatted = projects.map(formatProject).join("\n\n");
    return {
      content: [
        {
          type: "text",
          text: `Found ${projects.length} project(s):\n\n${formatted}`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[list_projects] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in list_projects: ${message}` },
      ],
      isError: true,
    };
  }
}

export function updateProjectHandler(
  params: Record<string, unknown>,
  db: Database.Database
): ToolResult {
  try {
    const parsed = UpdateProjectSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const { name, tech_stack, description, repo_path } = parsed.data;
    const updated = updateProject(db, name, {
      tech_stack,
      description,
      repo_path,
    });

    if (!updated) {
      return {
        content: [
          { type: "text", text: `Project "${name}" was not found.` },
        ],
      };
    }

    return {
      content: [
        { type: "text", text: `Project "${name}" updated successfully.` },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[update_project] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in update_project: ${message}` },
      ],
      isError: true,
    };
  }
}
