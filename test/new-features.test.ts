// Tests for the v0.1.0 feature additions:
//  - Soft delete + restore + purge + empty_trash
//  - Context history (versioning)
//  - Related context (by tag/project/category overlap)
//  - Search sessions
//  - Find unused (prune)
//  - Export / import hub
//  - DEV_MEMORY_DB_PATH env var

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initDb,
  saveContext,
  updateContext,
  deleteContext,
  restoreContext,
  purgeContext,
  purgeDeletedOlderThan,
  searchContexts,
  getContextById,
  listContextHistory,
  findRelated,
  searchSessions,
  findUnused,
  logSession,
  listProjects,
  getHubStats,
  exportHub,
  importHub,
} from "../src/db.js";

// ───────────────────────────────────────────────────────────────────
// Soft delete
// ───────────────────────────────────────────────────────────────────

describe("Soft delete", () => {
  it("deleteContext hides entries from default search but keeps them in the DB", () => {
    const db = initDb(":memory:");
    try {
      const id = saveContext(db, {
        project_name: "demo",
        title: "hydration error",
        content: "React 18 hydration mismatch detail",
        category: "gotcha",
        importance: 5,
      });

      expect(searchContexts(db, { query: "hydration" }).length).toBe(1);

      expect(deleteContext(db, id)).toBe(true);

      // Default search: gone
      expect(searchContexts(db, { query: "hydration" }).length).toBe(0);

      // include_deleted: visible
      const withDeleted = searchContexts(db, {
        query: "hydration",
        include_deleted: true,
      });
      expect(withDeleted.length).toBe(1);
      expect(withDeleted[0].id).toBe(id);
    } finally {
      db.close();
    }
  });

  it("getContextById returns null for soft-deleted entries by default", () => {
    const db = initDb(":memory:");
    try {
      const id = saveContext(db, {
        project_name: "demo",
        title: "something",
        content: "anything",
        category: "general",
        importance: 5,
      });
      deleteContext(db, id);

      expect(getContextById(db, id)).toBeNull();

      const allowed = getContextById(db, id, { include_deleted: true });
      expect(allowed).not.toBeNull();
      expect(allowed!.deleted_at).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it("getContextById does not increment usage for soft-deleted entries", () => {
    const db = initDb(":memory:");
    try {
      const id = saveContext(db, {
        project_name: "demo",
        title: "x",
        content: "y",
        category: "general",
        importance: 5,
      });
      deleteContext(db, id);

      getContextById(db, id, { include_deleted: true });
      getContextById(db, id, { include_deleted: true });

      const row = db
        .prepare("SELECT times_used FROM contexts WHERE id = ?")
        .get(id) as { times_used: number };
      expect(row.times_used).toBe(0);
    } finally {
      db.close();
    }
  });

  it("listProjects excludes soft-deleted from context_count", () => {
    const db = initDb(":memory:");
    try {
      const a = saveContext(db, {
        project_name: "demo",
        title: "a",
        content: "aaa",
        category: "general",
        importance: 5,
      });
      saveContext(db, {
        project_name: "demo",
        title: "b",
        content: "bbb",
        category: "general",
        importance: 5,
      });

      expect(listProjects(db)[0].context_count).toBe(2);
      deleteContext(db, a);
      expect(listProjects(db)[0].context_count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("getHubStats reports total_contexts without trash and trash_count separately", () => {
    const db = initDb(":memory:");
    try {
      const a = saveContext(db, {
        project_name: "demo",
        title: "a",
        content: "a",
        category: "general",
        importance: 5,
      });
      saveContext(db, {
        project_name: "demo",
        title: "b",
        content: "b",
        category: "general",
        importance: 5,
      });
      deleteContext(db, a);

      const stats = getHubStats(db);
      expect(stats.total_contexts).toBe(1);
      expect(stats.trash_count).toBe(1);
    } finally {
      db.close();
    }
  });
});

// ───────────────────────────────────────────────────────────────────
// Restore + purge
// ───────────────────────────────────────────────────────────────────

describe("Restore and purge", () => {
  it("restoreContext un-deletes an entry and usage tracking resumes", () => {
    const db = initDb(":memory:");
    try {
      const id = saveContext(db, {
        project_name: "demo",
        title: "foo",
        content: "bar",
        category: "general",
        importance: 5,
      });

      deleteContext(db, id);
      expect(getContextById(db, id)).toBeNull();

      expect(restoreContext(db, id)).toBe(true);
      const restored = getContextById(db, id);
      expect(restored).not.toBeNull();
      expect(restored!.deleted_at).toBeNull();
      expect(restored!.times_used).toBe(1); // get incremented it
    } finally {
      db.close();
    }
  });

  it("restoreContext returns false when entry is not in trash", () => {
    const db = initDb(":memory:");
    try {
      const id = saveContext(db, {
        project_name: "demo",
        title: "foo",
        content: "bar",
        category: "general",
        importance: 5,
      });
      expect(restoreContext(db, id)).toBe(false);
      expect(restoreContext(db, 999)).toBe(false);
    } finally {
      db.close();
    }
  });

  it("purgeContext hard-deletes the row and its history", () => {
    const db = initDb(":memory:");
    try {
      const id = saveContext(db, {
        project_name: "demo",
        title: "foo",
        content: "bar",
        category: "general",
        importance: 5,
      });
      updateContext(db, { id, title: "foo2" });
      expect(listContextHistory(db, id).length).toBe(1);

      expect(purgeContext(db, id)).toBe(true);

      const row = db
        .prepare("SELECT COUNT(*) AS n FROM contexts WHERE id = ?")
        .get(id) as { n: number };
      expect(row.n).toBe(0);

      const hist = db
        .prepare("SELECT COUNT(*) AS n FROM context_history WHERE context_id = ?")
        .get(id) as { n: number };
      expect(hist.n).toBe(0);
    } finally {
      db.close();
    }
  });

  it("purgeDeletedOlderThan only removes trashed rows past the threshold", () => {
    const db = initDb(":memory:");
    try {
      const a = saveContext(db, {
        project_name: "demo",
        title: "a",
        content: "a",
        category: "general",
        importance: 5,
      });
      const b = saveContext(db, {
        project_name: "demo",
        title: "b",
        content: "b",
        category: "general",
        importance: 5,
      });
      deleteContext(db, a);
      deleteContext(db, b);
      // Backdate one entry by 100 days
      db.prepare(
        "UPDATE contexts SET deleted_at = datetime('now', '-100 days') WHERE id = ?"
      ).run(a);

      const removed = purgeDeletedOlderThan(db, 30);
      expect(removed).toBe(1);

      const remaining = db
        .prepare("SELECT COUNT(*) AS n FROM contexts")
        .get() as { n: number };
      expect(remaining.n).toBe(1);
    } finally {
      db.close();
    }
  });
});

// ───────────────────────────────────────────────────────────────────
// History / versioning
// ───────────────────────────────────────────────────────────────────

describe("Context history", () => {
  it("updateContext captures a history row per meaningful edit", () => {
    const db = initDb(":memory:");
    try {
      const id = saveContext(db, {
        project_name: "demo",
        title: "v1",
        content: "body-1",
        category: "decision",
        importance: 5,
      });
      expect(listContextHistory(db, id).length).toBe(0);

      updateContext(db, { id, title: "v2" });
      updateContext(db, { id, content: "body-2" });
      updateContext(db, { id, importance: 7 });

      const hist = listContextHistory(db, id);
      expect(hist.length).toBe(3);
      // Newest first
      expect(hist[0].content).toBe("body-2");
      // Original title is in the oldest record
      expect(hist[hist.length - 1].title).toBe("v1");
    } finally {
      db.close();
    }
  });

  it("usage counter bumps do not create history rows", () => {
    const db = initDb(":memory:");
    try {
      const id = saveContext(db, {
        project_name: "demo",
        title: "x",
        content: "y",
        category: "general",
        importance: 5,
      });
      getContextById(db, id);
      getContextById(db, id);
      getContextById(db, id);
      expect(listContextHistory(db, id).length).toBe(0);
    } finally {
      db.close();
    }
  });
});

// ───────────────────────────────────────────────────────────────────
// Related context
// ───────────────────────────────────────────────────────────────────

describe("findRelated", () => {
  it("ranks by shared tags, then project, then category", () => {
    const db = initDb(":memory:");
    try {
      const seed = saveContext(db, {
        project_name: "frontend",
        title: "React hydration",
        content: "x",
        category: "gotcha",
        tags: "react,ssr,hydration",
        importance: 5,
      });
      // Same project + 2 shared tags → high score
      const rel1 = saveContext(db, {
        project_name: "frontend",
        title: "Next SSR hydration diff",
        content: "y",
        category: "gotcha",
        tags: "react,hydration,next",
        importance: 5,
      });
      // Different project, different category, 1 shared tag → low score
      saveContext(db, {
        project_name: "other",
        title: "Unrelated ssr thing",
        content: "z",
        category: "pattern",
        tags: "ssr",
        importance: 5,
      });
      // Nothing in common
      saveContext(db, {
        project_name: "other",
        title: "Go concurrency",
        content: "q",
        category: "snippet",
        tags: "go,channels",
        importance: 5,
      });

      const results = findRelated(db, seed, 5);
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].id).toBe(rel1);
      // Seed is excluded
      expect(results.find((r) => r.id === seed)).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("excludes soft-deleted candidates", () => {
    const db = initDb(":memory:");
    try {
      const seed = saveContext(db, {
        project_name: "p",
        title: "seed",
        content: "x",
        category: "general",
        tags: "alpha",
        importance: 5,
      });
      const hidden = saveContext(db, {
        project_name: "p",
        title: "hidden",
        content: "x",
        category: "general",
        tags: "alpha",
        importance: 5,
      });
      deleteContext(db, hidden);
      const results = findRelated(db, seed, 5);
      expect(results.find((r) => r.id === hidden)).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

// ───────────────────────────────────────────────────────────────────
// Session search
// ───────────────────────────────────────────────────────────────────

describe("searchSessions", () => {
  it("matches summary substrings and respects project filter", () => {
    const db = initDb(":memory:");
    try {
      logSession(db, {
        project_name: "backend",
        summary: "fixed auth bug",
        outcome: "merged",
      });
      logSession(db, {
        project_name: "frontend",
        summary: "shipped dark mode",
        outcome: "released",
      });
      logSession(db, {
        project_name: "backend",
        summary: "investigated auth race condition",
        outcome: "open",
      });

      const authAll = searchSessions(db, { query: "auth", limit: 10 });
      expect(authAll.length).toBe(2);

      const authBackend = searchSessions(db, {
        query: "auth",
        project_name: "backend",
        limit: 10,
      });
      expect(authBackend.length).toBe(2);

      const frontOnly = searchSessions(db, {
        project_name: "frontend",
        limit: 10,
      });
      expect(frontOnly.length).toBe(1);
    } finally {
      db.close();
    }
  });
});

// ───────────────────────────────────────────────────────────────────
// Unused / prune
// ───────────────────────────────────────────────────────────────────

describe("findUnused", () => {
  it("returns only live, zero-use entries older than N days", () => {
    const db = initDb(":memory:");
    try {
      const old = saveContext(db, {
        project_name: "p",
        title: "old",
        content: "x",
        category: "general",
        importance: 5,
      });
      const used = saveContext(db, {
        project_name: "p",
        title: "used",
        content: "x",
        category: "general",
        importance: 5,
      });
      const deleted = saveContext(db, {
        project_name: "p",
        title: "deleted",
        content: "x",
        category: "general",
        importance: 5,
      });
      // Make `old` look old
      db.prepare(
        "UPDATE contexts SET created_at = datetime('now', '-180 days') WHERE id = ?"
      ).run(old);
      db.prepare(
        "UPDATE contexts SET created_at = datetime('now', '-180 days') WHERE id = ?"
      ).run(deleted);
      deleteContext(db, deleted);
      getContextById(db, used); // bumps times_used to 1

      const results = findUnused(db, 90);
      expect(results.map((r) => r.id)).toEqual([old]);
    } finally {
      db.close();
    }
  });
});

// ───────────────────────────────────────────────────────────────────
// Export / import
// ───────────────────────────────────────────────────────────────────

describe("Export and import hub", () => {
  let tmpDir: string | null = null;
  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = null;
  });

  it("exportHub then importHub into a fresh DB preserves counts", () => {
    const dbA = initDb(":memory:");
    const dbB = initDb(":memory:");
    try {
      saveContext(dbA, {
        project_name: "proj",
        title: "a",
        content: "aaa",
        category: "pattern",
        tags: "x,y",
        importance: 7,
      });
      saveContext(dbA, {
        project_name: "proj",
        title: "b",
        content: "bbb",
        category: "decision",
        importance: 3,
      });
      logSession(dbA, {
        project_name: "proj",
        summary: "test",
        outcome: "ok",
      });

      const exported = exportHub(dbA, { include_deleted: false });
      expect(exported.projects.length).toBe(1);
      expect(exported.contexts.length).toBe(2);
      expect(exported.sessions.length).toBe(1);

      const result = importHub(dbB, exported, "merge");
      expect(result.projects).toBe(1);
      expect(result.contexts).toBe(2);
      expect(result.sessions).toBe(1);

      // Verify the FTS was populated via triggers on insert
      const found = searchContexts(dbB, { query: "aaa" });
      expect(found.length).toBe(1);
    } finally {
      dbA.close();
      dbB.close();
    }
  });

  it("importHub replace mode wipes before inserting", () => {
    const db = initDb(":memory:");
    try {
      saveContext(db, {
        project_name: "old",
        title: "old",
        content: "old",
        category: "general",
        importance: 5,
      });

      const fakeExport = {
        version: 1 as const,
        exported_at: new Date().toISOString(),
        projects: [
          {
            id: 1,
            name: "new",
            tech_stack: "",
            repo_path: "",
            description: "",
            created_at: "now",
            context_count: 0,
          },
        ],
        contexts: [
          {
            id: 1,
            project_id: 1,
            project_name: "new",
            title: "fresh",
            content: "fresh",
            category: "general",
            tags: "",
            language: "",
            file_path: "",
            importance: 5,
            times_used: 0,
            created_at: "now",
            updated_at: "now",
            deleted_at: null,
          },
        ],
        sessions: [],
      };

      importHub(db, fakeExport, "replace");

      const projects = listProjects(db);
      expect(projects.length).toBe(1);
      expect(projects[0].name).toBe("new");
    } finally {
      db.close();
    }
  });

  it("importHub rejects unsupported versions", () => {
    const db = initDb(":memory:");
    try {
      expect(() =>
        importHub(
          db,
          {
            version: 999 as unknown as 1,
            exported_at: "",
            projects: [],
            contexts: [],
            sessions: [],
          },
          "merge"
        )
      ).toThrow();
    } finally {
      db.close();
    }
  });
});

// ───────────────────────────────────────────────────────────────────
// DEV_MEMORY_DB_PATH env var
// ───────────────────────────────────────────────────────────────────

describe("DEV_MEMORY_DB_PATH environment variable", () => {
  it("initDb uses the env var path when no explicit path is given", () => {
    const dir = mkdtempSync(join(tmpdir(), "dev-memory-test-"));
    const dbPath = join(dir, "from-env.db");
    const prior = process.env.DEV_MEMORY_DB_PATH;
    process.env.DEV_MEMORY_DB_PATH = dbPath;
    try {
      const db = initDb();
      try {
        saveContext(db, {
          project_name: "p",
          title: "t",
          content: "c",
          category: "general",
          importance: 5,
        });
      } finally {
        db.close();
      }
      expect(existsSync(dbPath)).toBe(true);

      // Reopen the same path and confirm the row survived
      const db2 = initDb();
      try {
        const rows = listProjects(db2);
        expect(rows.length).toBe(1);
        expect(rows[0].name).toBe("p");
      } finally {
        db2.close();
      }
    } finally {
      if (prior === undefined) delete process.env.DEV_MEMORY_DB_PATH;
      else process.env.DEV_MEMORY_DB_PATH = prior;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explicit path takes precedence over env var", () => {
    const dir = mkdtempSync(join(tmpdir(), "dev-memory-test-"));
    const envPath = join(dir, "env.db");
    const explicitPath = join(dir, "explicit.db");
    const prior = process.env.DEV_MEMORY_DB_PATH;
    process.env.DEV_MEMORY_DB_PATH = envPath;
    try {
      const db = initDb(explicitPath);
      try {
        saveContext(db, {
          project_name: "p",
          title: "t",
          content: "c",
          category: "general",
          importance: 5,
        });
      } finally {
        db.close();
      }
      expect(existsSync(explicitPath)).toBe(true);
      expect(existsSync(envPath)).toBe(false);
    } finally {
      if (prior === undefined) delete process.env.DEV_MEMORY_DB_PATH;
      else process.env.DEV_MEMORY_DB_PATH = prior;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
