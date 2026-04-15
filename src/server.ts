#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type Database from "better-sqlite3";
import { initDb } from "./db.js";
import {
  SearchContextSchema,
  GetContextSchema,
  SaveContextSchema,
  UpdateContextSchema,
  DeleteContextSchema,
  UpdateProjectSchema,
  LogSessionSchema,
  ScanProjectSchema,
} from "./types.js";
import { searchHandler, getContextHandler } from "./tools/search.js";
import { saveHandler, updateHandler, deleteHandler } from "./tools/save.js";
import {
  listProjectsHandler,
  updateProjectHandler,
} from "./tools/projects.js";
import { getHubStatsHandler } from "./tools/stats.js";
import { logSessionHandler } from "./tools/sessions.js";
import { scanProjectHandler } from "./tools/scan.js";

/**
 * Creates and configures the McpServer with all tools registered.
 * Exported for integration testing.
 */
export function createServer(db: Database.Database): McpServer {
  const server = new McpServer({ name: "dev-memory", version: "2.0.0" });

  // ── Search & Retrieve ──────────────────────────────────────────────

  server.tool(
    "search_context",
    "Full-text search across the knowledge hub. Supports optional category, project_name, and technology filters. Returns summaries — use get_context for full content.",
    SearchContextSchema.shape,
    (params) => searchHandler(params as Record<string, unknown>, db)
  );

  server.tool(
    "get_context",
    "Fetch a single knowledge entry by id with full content. Use after search_context to retrieve entries that look relevant.",
    GetContextSchema.shape,
    (params) => getContextHandler(params as Record<string, unknown>, db)
  );

  // ── Create / Update / Delete ───────────────────────────────────────

  server.tool(
    "save_context",
    "Save a new knowledge entry (pattern, decision, gotcha, snippet, etc.). Auto-creates the project if it doesn't exist.",
    SaveContextSchema.shape,
    (params) => saveHandler(params as Record<string, unknown>, db)
  );

  server.tool(
    "update_context",
    "Partial update of an existing knowledge entry. Only provided fields are changed; usage count and timestamps are preserved.",
    UpdateContextSchema.shape,
    (params) => updateHandler(params as Record<string, unknown>, db)
  );

  server.tool(
    "delete_context",
    "Delete an outdated or incorrect knowledge entry by its id.",
    DeleteContextSchema.shape,
    (params) => deleteHandler(params as Record<string, unknown>, db)
  );

  // ── Projects ───────────────────────────────────────────────────────

  server.tool(
    "list_projects",
    "List all projects with their tech stacks and context counts.",
    {},
    (_params) => listProjectsHandler({}, db)
  );

  server.tool(
    "update_project",
    "Update a project's tech_stack, description, or repo_path.",
    UpdateProjectSchema.shape,
    (params) => updateProjectHandler(params as Record<string, unknown>, db)
  );

  // ── Stats & Sessions ───────────────────────────────────────────────

  server.tool(
    "get_hub_stats",
    "Aggregate statistics: project/context counts, category breakdown, top used, most recent.",
    {},
    (_params) => getHubStatsHandler({}, db)
  );

  server.tool(
    "log_session",
    "Log a coding session with summary, outcome, and context IDs used. Auto-creates the project if needed.",
    LogSessionSchema.shape,
    (params) => logSessionHandler(params as Record<string, unknown>, db)
  );

  // ── Bootstrap ──────────────────────────────────────────────────────

  server.tool(
    "scan_project",
    "Scan a project directory to detect tech stack, config, and structure. Returns findings for the user to review — does NOT auto-save. Use this to bootstrap an empty knowledge base for a new project.",
    ScanProjectSchema.shape,
    (params) => scanProjectHandler(params as Record<string, unknown>)
  );

  return server;
}

async function main(): Promise<void> {
  const db = initDb();
  const server = createServer(db);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dev-memory v2 server started on STDIO transport");
}

main().catch((err) => {
  console.error("Fatal error starting dev-memory:", err);
  process.exit(1);
});
