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
  RestoreContextSchema,
  PurgeContextSchema,
  EmptyTrashSchema,
  ListHistorySchema,
  ExportHubSchema,
  ImportHubSchema,
  RelatedContextSchema,
  SearchSessionsSchema,
  PruneUnusedSchema,
} from "./types.js";
import { searchHandler, getContextHandler } from "./tools/search.js";
import { saveHandler, updateHandler, deleteHandler } from "./tools/save.js";
import {
  listProjectsHandler,
  updateProjectHandler,
} from "./tools/projects.js";
import { getHubStatsHandler } from "./tools/stats.js";
import { logSessionHandler, searchSessionsHandler } from "./tools/sessions.js";
import { scanProjectHandler } from "./tools/scan.js";
import {
  restoreHandler,
  purgeHandler,
  emptyTrashHandler,
  listTrashHandler,
} from "./tools/trash.js";
import { listHistoryHandler } from "./tools/history.js";
import { exportHandler, importHandler } from "./tools/backup.js";
import { relatedHandler } from "./tools/related.js";
import { pruneUnusedHandler } from "./tools/prune.js";

/**
 * Creates and configures the McpServer with all tools registered.
 * Exported for integration testing.
 */
export function createServer(db: Database.Database): McpServer {
  const server = new McpServer({ name: "dev-memory", version: "0.1.0" });

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

  // ── Trash & recovery ───────────────────────────────────────────────

  server.tool(
    "list_trash",
    "List soft-deleted context entries (most recent first). Use restore_context(id) or purge_context(id).",
    {},
    (_params) => listTrashHandler({}, db)
  );

  server.tool(
    "restore_context",
    "Restore a soft-deleted context entry from the trash.",
    RestoreContextSchema.shape,
    (params) => restoreHandler(params as Record<string, unknown>, db)
  );

  server.tool(
    "purge_context",
    "Permanently delete a context entry (and its history). Bypasses the trash — not recoverable.",
    PurgeContextSchema.shape,
    (params) => purgeHandler(params as Record<string, unknown>, db)
  );

  server.tool(
    "empty_trash",
    "Permanently delete all trashed entries older than `older_than_days` (default 0 = all).",
    EmptyTrashSchema.shape,
    (params) => emptyTrashHandler(params as Record<string, unknown>, db)
  );

  // ── History ────────────────────────────────────────────────────────

  server.tool(
    "list_history",
    "List the edit history of a context entry (newest revision first). Shows how a decision or note has evolved.",
    ListHistorySchema.shape,
    (params) => listHistoryHandler(params as Record<string, unknown>, db)
  );

  // ── Backup / Import ────────────────────────────────────────────────

  server.tool(
    "export_hub",
    "Write the full hub to a JSON file (projects, contexts, sessions). Use for backup, migration, or sharing across machines.",
    ExportHubSchema.shape,
    (params) => exportHandler(params as Record<string, unknown>, db)
  );

  server.tool(
    "import_hub",
    "Load a hub export from a JSON file. `mode: 'merge'` (default) keeps existing data; `mode: 'replace'` wipes first.",
    ImportHubSchema.shape,
    (params) => importHandler(params as Record<string, unknown>, db)
  );

  // ── Relations ──────────────────────────────────────────────────────

  server.tool(
    "related_context",
    "Find contexts related to a given entry by shared tags, project, or category. Useful for impact tracing and mental-context rebuild.",
    RelatedContextSchema.shape,
    (params) => relatedHandler(params as Record<string, unknown>, db)
  );

  // ── Sessions search ────────────────────────────────────────────────

  server.tool(
    "search_sessions",
    "Search logged sessions by summary/outcome substring. Helps with meeting prep and rebuilding recent project context.",
    SearchSessionsSchema.shape,
    (params) => searchSessionsHandler(params as Record<string, unknown>, db)
  );

  // ── Data hygiene ───────────────────────────────────────────────────

  server.tool(
    "prune_unused",
    "Find or soft-delete entries with times_used=0 older than N days. Defaults to a dry-run; pass apply:true to soft-delete.",
    PruneUnusedSchema.shape,
    (params) => pruneUnusedHandler(params as Record<string, unknown>, db)
  );

  return server;
}

async function main(): Promise<void> {
  const db = initDb();
  const server = createServer(db);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe — stdout is reserved for JSON-RPC frames
  console.error("dev-memory MCP server ready (STDIO transport)");
}

main().catch((err) => {
  console.error("Fatal error starting dev-memory:", err);
  process.exit(1);
});
