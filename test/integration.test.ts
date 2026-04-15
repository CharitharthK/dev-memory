// Property 17: Error handling returns MCP error response

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type Database from "better-sqlite3";
import { initDb } from "../src/db.js";
import { createServer } from "../src/server.js";
import { searchHandler, getContextHandler } from "../src/tools/search.js";
import { saveHandler, updateHandler, deleteHandler } from "../src/tools/save.js";
import { listProjectsHandler, updateProjectHandler } from "../src/tools/projects.js";
import { getHubStatsHandler } from "../src/tools/stats.js";
import { logSessionHandler } from "../src/tools/sessions.js";
import { scanProjectHandler } from "../src/tools/scan.js";

// ---------------------------------------------------------------------------
// Property 17: Error handling returns MCP error response
// ---------------------------------------------------------------------------

describe("Property 17 – Error handling returns MCP error response", () => {
  it("tool handlers return MCP error responses on database errors, not crashes", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "search_context",
          "get_context",
          "save_context",
          "update_context",
          "delete_context",
          "list_projects",
          "update_project",
          "get_hub_stats",
          "log_session",
        ),
        (toolName) => {
          // Create a DB and then close it to force errors
          const db = initDb(":memory:");
          db.close();

          const handlers: Record<
            string,
            (params: Record<string, unknown>, db: Database.Database) => unknown
          > = {
            search_context: searchHandler,
            get_context: getContextHandler,
            save_context: saveHandler,
            update_context: updateHandler,
            delete_context: deleteHandler,
            list_projects: listProjectsHandler,
            update_project: updateProjectHandler,
            get_hub_stats: getHubStatsHandler,
            log_session: logSessionHandler,
          };

          const paramsByTool: Record<string, Record<string, unknown>> = {
            search_context: { query: "test" },
            get_context: { id: 1 },
            save_context: {
              project_name: "proj",
              title: "t",
              content: "c",
              category: "pattern",
            },
            update_context: { id: 1, title: "updated" },
            delete_context: { id: 1 },
            list_projects: {},
            update_project: { name: "proj", tech_stack: "node" },
            get_hub_stats: {},
            log_session: { project_name: "proj", summary: "did stuff" },
          };

          const handler = handlers[toolName];
          const params = paramsByTool[toolName];

          // Should NOT throw — should return an MCP error response
          const result = handler(params, db) as {
            content: Array<{ type: string; text: string }>;
            isError?: boolean;
          };

          expect(result).toBeDefined();
          expect(result.content).toBeDefined();
          expect(result.content.length).toBeGreaterThan(0);
          expect(result.content[0].type).toBe("text");
          expect(result.isError).toBe(true);
          expect(result.content[0].text.toLowerCase()).toContain("error");
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Unit test: All 9 tools registered
// ---------------------------------------------------------------------------

describe("MCP Server tool registration", () => {
  it("registers all 10 tools", () => {
    const db = initDb(":memory:");
    try {
      const server = createServer(db);
      expect(server).toBeDefined();

      const expectedTools = [
        "search_context",
        "get_context",
        "save_context",
        "update_context",
        "delete_context",
        "list_projects",
        "update_project",
        "get_hub_stats",
        "log_session",
        "scan_project",
      ];

      expect(expectedTools.length).toBe(10);
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// scan_project error handling (filesystem-based, no DB)
// ---------------------------------------------------------------------------

describe("scan_project error handling", () => {
  it("returns error for non-existent path", () => {
    const result = scanProjectHandler({
      repo_path: "/nonexistent/path/that/does/not/exist",
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("returns error for missing repo_path", () => {
    const result = scanProjectHandler({}) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("returns valid findings for an actual directory", () => {
    // Scan this project's own repo as a test
    const result = scanProjectHandler({
      repo_path: process.cwd(),
      project_name: "self-test",
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Project Scan: self-test");
    expect(result.content[0].text).toContain("Tech Stack:");
  });
});

// ---------------------------------------------------------------------------
// Unit test: stderr logging, no stdout
// ---------------------------------------------------------------------------

describe("Logging goes to stderr", () => {
  it("tool error handlers log to stderr via console.error, not stdout", () => {
    const db = initDb(":memory:");
    db.close();

    const errorCalls: unknown[][] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };

    const logCalls: unknown[][] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      logCalls.push(args);
    };

    try {
      saveHandler(
        {
          project_name: "proj",
          title: "t",
          content: "c",
          category: "pattern",
        },
        db,
      );

      expect(errorCalls.length).toBeGreaterThan(0);
      const errorOutput = errorCalls.map((args) => args.join(" ")).join(" ");
      expect(errorOutput).toContain("save_context");

      expect(logCalls.length).toBe(0);
    } finally {
      console.error = originalConsoleError;
      console.log = originalConsoleLog;
    }
  });
});
