import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type {
  SaveContextInput,
  UpdateContextInput,
  LogSessionInput,
  ContextRow,
  ContextSummary,
  ProjectRow,
} from "./types.js";

export type { Database };

/** Max characters of content included in search summaries. */
const PREVIEW_LENGTH = 180;

const SCHEMA_DDL = `
-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  tech_stack TEXT DEFAULT '',
  repo_path TEXT DEFAULT '',
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Contexts table
CREATE TABLE IF NOT EXISTS contexts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT DEFAULT '',
  language TEXT DEFAULT '',
  file_path TEXT DEFAULT '',
  importance INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  times_used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  summary TEXT NOT NULL,
  contexts_used TEXT DEFAULT '[]',
  outcome TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for common filter/join paths
CREATE INDEX IF NOT EXISTS idx_contexts_project ON contexts(project_id);
CREATE INDEX IF NOT EXISTS idx_contexts_category ON contexts(category);
CREATE INDEX IF NOT EXISTS idx_contexts_importance ON contexts(importance DESC, times_used DESC);

-- FTS5 virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS contexts_fts USING fts5(
  title, content, tags, category,
  content='contexts',
  content_rowid='id'
);

-- FTS sync triggers
CREATE TRIGGER IF NOT EXISTS contexts_ai AFTER INSERT ON contexts BEGIN
  INSERT INTO contexts_fts(rowid, title, content, tags, category)
  VALUES (new.id, new.title, new.content, new.tags, new.category);
END;

CREATE TRIGGER IF NOT EXISTS contexts_ad AFTER DELETE ON contexts BEGIN
  INSERT INTO contexts_fts(contexts_fts, rowid, title, content, tags, category)
  VALUES ('delete', old.id, old.title, old.content, old.tags, old.category);
END;

CREATE TRIGGER IF NOT EXISTS contexts_au AFTER UPDATE ON contexts BEGIN
  INSERT INTO contexts_fts(contexts_fts, rowid, title, content, tags, category)
  VALUES ('delete', old.id, old.title, old.content, old.tags, old.category);
  INSERT INTO contexts_fts(rowid, title, content, tags, category)
  VALUES (new.id, new.title, new.content, new.tags, new.category);
END;
`;

export function initDb(dbPath?: string): Database.Database {
  const resolvedPath =
    dbPath ?? join(homedir(), ".dev-memory", "context.db");

  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const db = new Database(resolvedPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_DDL);

  return db;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Get-or-create a project by name. Returns the project id in a single
 * statement when possible, avoiding two round-trips.
 */
function getOrCreateProjectId(db: Database.Database, name: string): number {
  db.prepare("INSERT OR IGNORE INTO projects (name) VALUES (?)").run(name);
  const row = db
    .prepare("SELECT id FROM projects WHERE name = ?")
    .get(name) as { id: number };
  return row.id;
}

/**
 * Sanitise a user-supplied string for FTS5 MATCH.
 * Strips special FTS operators, double-quotes each token, and joins
 * with implicit AND so partial / natural-language queries work.
 */
function sanitizeFtsQuery(raw: string): string {
  // Remove FTS5 operators and special chars
  const cleaned = raw.replace(/["\*\(\){}:^~\-]/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return '""';
  // Quote each token — safe from injection, implicit AND between them
  return tokens.map((t) => `"${t}"`).join(" ");
}

/** Truncate content to a preview suitable for search results. */
function toPreview(content: string): string {
  if (content.length <= PREVIEW_LENGTH) return content;
  return content.slice(0, PREVIEW_LENGTH) + "…";
}

// ── CRUD ─────────────────────────────────────────────────────────────

/**
 * Unified search returning **summaries** (truncated content).
 *
 * - If `query` is provided, runs FTS5 full-text search.
 * - If only `technology` is provided, runs LIKE on projects.tech_stack.
 * - Both can be combined.
 * - Category and project_name act as additional filters.
 *
 * Usage counters are NOT incremented here — they are bumped only when
 * the caller fetches the full entry via getContextById, reducing
 * wasted writes on results the AI never actually reads.
 */
export function searchContexts(
  db: Database.Database,
  opts: {
    query?: string;
    category?: string;
    project_name?: string;
    technology?: string;
    limit?: number;
  }
): ContextSummary[] {
  const limit = opts.limit ?? 10;
  const params: unknown[] = [];
  const conditions: string[] = [];
  let fromClause: string;
  let orderClause: string;

  if (opts.query) {
    const safeQuery = sanitizeFtsQuery(opts.query);
    fromClause = `
      contexts_fts fts
      JOIN contexts c ON c.id = fts.rowid
      JOIN projects p ON p.id = c.project_id`;
    conditions.push("contexts_fts MATCH ?");
    params.push(safeQuery);
    // BM25 with column weights: title(10), content(1), tags(5), category(3)
    orderClause = "ORDER BY bm25(contexts_fts, 10.0, 1.0, 5.0, 3.0)";
  } else {
    fromClause = `
      contexts c
      JOIN projects p ON p.id = c.project_id`;
    orderClause = "ORDER BY c.importance DESC, c.times_used DESC";
  }

  if (opts.technology) {
    conditions.push("p.tech_stack LIKE ? COLLATE NOCASE");
    params.push(`%${opts.technology}%`);
  }

  if (opts.category) {
    conditions.push("c.category = ?");
    params.push(opts.category);
  }

  if (opts.project_name) {
    conditions.push("p.name = ?");
    params.push(opts.project_name);
  }

  // Must have at least one search vector
  if (conditions.length === 0) {
    return [];
  }

  const whereClause = "WHERE " + conditions.join(" AND ");

  const sql = `
    SELECT c.id, p.name AS project_name, c.title, c.category,
           c.tags, c.importance, c.times_used, c.content
    FROM ${fromClause}
    ${whereClause}
    ${orderClause}
    LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Array<
    Omit<ContextSummary, "preview"> & { content: string }
  >;

  return rows.map((r) => ({
    id: r.id,
    project_name: r.project_name,
    title: r.title,
    category: r.category,
    tags: r.tags,
    importance: r.importance,
    times_used: r.times_used,
    preview: toPreview(r.content),
  }));
}

/**
 * Fetch a single context entry by id with **full** content.
 * Increments times_used — this is the only place usage is tracked,
 * ensuring the counter reflects entries the AI actually consumed.
 */
export function getContextById(
  db: Database.Database,
  id: number
): ContextRow | null {
  const row = db
    .prepare(
      `SELECT c.*, p.name AS project_name
       FROM contexts c
       JOIN projects p ON p.id = c.project_id
       WHERE c.id = ?`
    )
    .get(id) as ContextRow | undefined;

  if (!row) return null;

  // Increment usage — only on explicit fetch
  db.prepare(
    "UPDATE contexts SET times_used = times_used + 1 WHERE id = ?"
  ).run(id);

  return { ...row, times_used: row.times_used + 1 };
}

/**
 * Insert a context entry, auto-creating the project if needed.
 * Returns the new context id.
 */
export function saveContext(
  db: Database.Database,
  entry: SaveContextInput
): number {
  const projectId = getOrCreateProjectId(db, entry.project_name);

  const result = db
    .prepare(
      `INSERT INTO contexts (project_id, title, content, category, tags, language, file_path, importance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      projectId,
      entry.title,
      entry.content,
      entry.category,
      entry.tags ?? "",
      entry.language ?? "",
      entry.file_path ?? "",
      entry.importance ?? 5
    );

  return Number(result.lastInsertRowid);
}

/**
 * Partial update of a context entry. Only provided fields are changed.
 * Returns true if a row was updated.
 */
export function updateContext(
  db: Database.Database,
  entry: UpdateContextInput
): boolean {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  const fields: Array<[keyof UpdateContextInput, string]> = [
    ["title", "title"],
    ["content", "content"],
    ["category", "category"],
    ["tags", "tags"],
    ["language", "language"],
    ["file_path", "file_path"],
    ["importance", "importance"],
  ];

  for (const [key, col] of fields) {
    if (entry[key] !== undefined) {
      setClauses.push(`${col} = ?`);
      params.push(entry[key]);
    }
  }

  if (setClauses.length === 0) return false;

  // Always bump updated_at
  setClauses.push("updated_at = datetime('now')");

  params.push(entry.id);
  const result = db
    .prepare(
      `UPDATE contexts SET ${setClauses.join(", ")} WHERE id = ?`
    )
    .run(...params);

  return result.changes > 0;
}

/**
 * Delete a context entry by id. Returns true if a row was deleted.
 */
export function deleteContext(db: Database.Database, id: number): boolean {
  const result = db.prepare("DELETE FROM contexts WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * List all projects with their context counts.
 */
export function listProjects(db: Database.Database): ProjectRow[] {
  return db
    .prepare(
      `SELECT p.*, COUNT(c.id) AS context_count
       FROM projects p
       LEFT JOIN contexts c ON c.project_id = p.id
       GROUP BY p.id
       ORDER BY p.name`
    )
    .all() as ProjectRow[];
}

/**
 * Partial update of a project's metadata.
 * Returns true if a row was updated.
 */
export function updateProject(
  db: Database.Database,
  name: string,
  fields: { tech_stack?: string; description?: string; repo_path?: string }
): boolean {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (fields.tech_stack !== undefined) {
    setClauses.push("tech_stack = ?");
    params.push(fields.tech_stack);
  }
  if (fields.description !== undefined) {
    setClauses.push("description = ?");
    params.push(fields.description);
  }
  if (fields.repo_path !== undefined) {
    setClauses.push("repo_path = ?");
    params.push(fields.repo_path);
  }

  if (setClauses.length === 0) return false;

  params.push(name);
  const result = db
    .prepare(`UPDATE projects SET ${setClauses.join(", ")} WHERE name = ?`)
    .run(...params);

  return result.changes > 0;
}

/**
 * Aggregate stats for the hub overview.
 */
export function getHubStats(db: Database.Database): {
  total_projects: number;
  total_contexts: number;
  categories: Record<string, number>;
  top_used: ContextSummary[];
  recent: ContextSummary[];
} {
  const { count: totalProjects } = db
    .prepare("SELECT COUNT(*) AS count FROM projects")
    .get() as { count: number };

  const { count: totalContexts } = db
    .prepare("SELECT COUNT(*) AS count FROM contexts")
    .get() as { count: number };

  const categoryRows = db
    .prepare(
      "SELECT category, COUNT(*) AS count FROM contexts GROUP BY category"
    )
    .all() as { category: string; count: number }[];

  const categories: Record<string, number> = {};
  for (const row of categoryRows) {
    categories[row.category] = row.count;
  }

  const topUsedRaw = db
    .prepare(
      `SELECT c.id, p.name AS project_name, c.title, c.category,
              c.tags, c.importance, c.times_used, c.content
       FROM contexts c
       JOIN projects p ON p.id = c.project_id
       ORDER BY c.times_used DESC
       LIMIT 5`
    )
    .all() as Array<Omit<ContextSummary, "preview"> & { content: string }>;

  const recentRaw = db
    .prepare(
      `SELECT c.id, p.name AS project_name, c.title, c.category,
              c.tags, c.importance, c.times_used, c.content
       FROM contexts c
       JOIN projects p ON p.id = c.project_id
       ORDER BY c.created_at DESC
       LIMIT 5`
    )
    .all() as Array<Omit<ContextSummary, "preview"> & { content: string }>;

  const toSummary = (
    r: Omit<ContextSummary, "preview"> & { content: string }
  ): ContextSummary => ({
    id: r.id,
    project_name: r.project_name,
    title: r.title,
    category: r.category,
    tags: r.tags,
    importance: r.importance,
    times_used: r.times_used,
    preview: toPreview(r.content),
  });

  return {
    total_projects: totalProjects,
    total_contexts: totalContexts,
    categories,
    top_used: topUsedRaw.map(toSummary),
    recent: recentRaw.map(toSummary),
  };
}

/**
 * Insert a session, auto-creating the project if needed.
 */
export function logSession(
  db: Database.Database,
  entry: LogSessionInput
): number {
  const projectId = getOrCreateProjectId(db, entry.project_name);
  const contextsUsedJson = JSON.stringify(entry.context_ids_used ?? []);

  const result = db
    .prepare(
      `INSERT INTO sessions (project_id, summary, contexts_used, outcome)
       VALUES (?, ?, ?, ?)`
    )
    .run(projectId, entry.summary, contextsUsedJson, entry.outcome ?? "");

  return Number(result.lastInsertRowid);
}
