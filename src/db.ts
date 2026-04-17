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
  updated_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- Context history — one row per update, for decision-evolution timelines.
-- Populated by the contexts_bu trigger below on every UPDATE of contexts.
CREATE TABLE IF NOT EXISTS context_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  context_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT DEFAULT '',
  importance INTEGER,
  changed_at TEXT DEFAULT (datetime('now'))
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
CREATE INDEX IF NOT EXISTS idx_contexts_deleted ON contexts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_history_context ON context_history(context_id, changed_at DESC);

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

-- Capture the previous version of a context whenever a meaningful field
-- changes. times_used and deleted_at bumps are ignored — only real content
-- edits are recorded.
CREATE TRIGGER IF NOT EXISTS contexts_history_bu
BEFORE UPDATE ON contexts
WHEN old.title      IS NOT new.title
  OR old.content    IS NOT new.content
  OR old.category   IS NOT new.category
  OR old.tags       IS NOT new.tags
  OR old.importance IS NOT new.importance
BEGIN
  INSERT INTO context_history (context_id, title, content, category, tags, importance)
  VALUES (old.id, old.title, old.content, old.category, old.tags, old.importance);
END;
`;

/**
 * Initialise the SQLite database.
 *
 * Path resolution order:
 *   1. Explicit `dbPath` argument (used by tests)
 *   2. `DEV_MEMORY_DB_PATH` environment variable
 *   3. `~/.dev-memory/context.db` (default)
 *
 * Pass `":memory:"` for an in-memory DB (also used by tests).
 */
export function initDb(dbPath?: string): Database.Database {
  const resolvedPath =
    dbPath ??
    process.env.DEV_MEMORY_DB_PATH ??
    join(homedir(), ".dev-memory", "context.db");

  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const db = new Database(resolvedPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_DDL);

  // Lightweight forward-only migrations for databases created before
  // a column was introduced. CREATE TABLE IF NOT EXISTS is a no-op on
  // existing tables, so we add missing columns explicitly here.
  applyMigrations(db);

  return db;
}

/** Add any missing columns to an existing database. Idempotent. */
function applyMigrations(db: Database.Database): void {
  const contextCols = db
    .prepare("PRAGMA table_info(contexts)")
    .all() as Array<{ name: string }>;
  const names = new Set(contextCols.map((c) => c.name));

  if (!names.has("deleted_at")) {
    db.exec("ALTER TABLE contexts ADD COLUMN deleted_at TEXT");
  }
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
 * Soft-deleted entries (those with `deleted_at` set) are excluded by
 * default. Pass `include_deleted: true` to include them — used by the
 * trash/restore flow.
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
    include_deleted?: boolean;
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

  if (!opts.include_deleted) {
    conditions.push("c.deleted_at IS NULL");
  }

  // Must have at least one search vector (excluding the deleted_at filter)
  const hasSearchVector =
    !!opts.query ||
    !!opts.technology ||
    !!opts.category ||
    !!opts.project_name;
  if (!hasSearchVector) {
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
 *
 * Increments times_used — this is the only place usage is tracked,
 * ensuring the counter reflects entries the AI actually consumed.
 *
 * Soft-deleted entries return null unless `include_deleted: true`.
 * Usage is never incremented for soft-deleted entries.
 */
export function getContextById(
  db: Database.Database,
  id: number,
  opts: { include_deleted?: boolean } = {}
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
  if (row.deleted_at && !opts.include_deleted) return null;

  // Increment usage — only on explicit fetch of a live entry
  if (!row.deleted_at) {
    db.prepare(
      "UPDATE contexts SET times_used = times_used + 1 WHERE id = ?"
    ).run(id);
    return { ...row, times_used: row.times_used + 1 };
  }

  return row;
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
 * Soft-delete a context entry by id. Sets `deleted_at` so the entry is
 * hidden from normal search/get but can be recovered with `restoreContext`.
 * Returns true if a row was marked as deleted.
 */
export function deleteContext(db: Database.Database, id: number): boolean {
  const result = db
    .prepare(
      "UPDATE contexts SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL"
    )
    .run(id);
  return result.changes > 0;
}

/**
 * Restore a soft-deleted context entry. Returns true if a row was
 * restored.
 */
export function restoreContext(db: Database.Database, id: number): boolean {
  const result = db
    .prepare(
      "UPDATE contexts SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL"
    )
    .run(id);
  return result.changes > 0;
}

/**
 * Permanently delete a context entry (bypasses the trash). Also removes
 * its history. Returns true if a row was deleted.
 */
export function purgeContext(db: Database.Database, id: number): boolean {
  const tx = db.transaction((cid: number) => {
    db.prepare("DELETE FROM context_history WHERE context_id = ?").run(cid);
    const res = db.prepare("DELETE FROM contexts WHERE id = ?").run(cid);
    return res.changes > 0;
  });
  return tx(id);
}

/**
 * Purge all context entries whose deleted_at is older than `olderThanDays`.
 * Returns the number of rows purged.
 */
export function purgeDeletedOlderThan(
  db: Database.Database,
  olderThanDays: number
): number {
  const tx = db.transaction((days: number) => {
    // Collect ids first so we can clean history too
    const ids = db
      .prepare(
        `SELECT id FROM contexts
         WHERE deleted_at IS NOT NULL
           AND deleted_at < datetime('now', ?)`
      )
      .all(`-${days} days`) as Array<{ id: number }>;
    if (ids.length === 0) return 0;
    const idList = ids.map((r) => r.id);
    const placeholders = idList.map(() => "?").join(",");
    db.prepare(
      `DELETE FROM context_history WHERE context_id IN (${placeholders})`
    ).run(...idList);
    db.prepare(`DELETE FROM contexts WHERE id IN (${placeholders})`).run(
      ...idList
    );
    return idList.length;
  });
  return tx(olderThanDays);
}

/**
 * List the edit history for a single context, newest first.
 *
 * Ordered by `id DESC` rather than `changed_at DESC` because SQLite's
 * `datetime('now')` has one-second resolution, so multiple rapid edits
 * share a timestamp. The AUTOINCREMENT id is always monotonic.
 */
export function listContextHistory(
  db: Database.Database,
  contextId: number
): Array<{
  id: number;
  context_id: number;
  title: string;
  content: string;
  category: string;
  tags: string;
  importance: number;
  changed_at: string;
}> {
  return db
    .prepare(
      `SELECT * FROM context_history
       WHERE context_id = ?
       ORDER BY id DESC`
    )
    .all(contextId) as Array<{
    id: number;
    context_id: number;
    title: string;
    content: string;
    category: string;
    tags: string;
    importance: number;
    changed_at: string;
  }>;
}

/**
 * List all projects with their (non-deleted) context counts.
 *
 * Uses `COUNT(c.id)` with the deleted filter in a JOIN condition so
 * projects with zero matching contexts correctly report 0 (SQL COUNT
 * ignores NULLs, and a LEFT JOIN miss yields a NULL c.id).
 */
export function listProjects(db: Database.Database): ProjectRow[] {
  return db
    .prepare(
      `SELECT p.*, COUNT(c.id) AS context_count
       FROM projects p
       LEFT JOIN contexts c
         ON c.project_id = p.id AND c.deleted_at IS NULL
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
  trash_count: number;
  categories: Record<string, number>;
  top_used: ContextSummary[];
  recent: ContextSummary[];
} {
  const { count: totalProjects } = db
    .prepare("SELECT COUNT(*) AS count FROM projects")
    .get() as { count: number };

  const { count: totalContexts } = db
    .prepare(
      "SELECT COUNT(*) AS count FROM contexts WHERE deleted_at IS NULL"
    )
    .get() as { count: number };

  const { count: trashCount } = db
    .prepare(
      "SELECT COUNT(*) AS count FROM contexts WHERE deleted_at IS NOT NULL"
    )
    .get() as { count: number };

  const categoryRows = db
    .prepare(
      `SELECT category, COUNT(*) AS count FROM contexts
       WHERE deleted_at IS NULL GROUP BY category`
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
       WHERE c.deleted_at IS NULL
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
       WHERE c.deleted_at IS NULL
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
    trash_count: trashCount,
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

/**
 * Find contexts related to a seed context by tag and project overlap.
 *
 * Scoring: shared tag = 2pts, same project = 1pt, same category = 1pt.
 * The seed itself is excluded. Soft-deleted entries are excluded.
 */
export function findRelated(
  db: Database.Database,
  seedId: number,
  limit: number
): Array<ContextSummary & { score: number }> {
  const seed = db
    .prepare(
      `SELECT c.id, c.project_id, c.category, c.tags
       FROM contexts c WHERE c.id = ? AND c.deleted_at IS NULL`
    )
    .get(seedId) as
    | { id: number; project_id: number; category: string; tags: string }
    | undefined;
  if (!seed) return [];

  const seedTags = seed.tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // Pull candidates from the same project OR sharing any tag / category.
  // We score in memory — candidate set is small.
  const candidates = db
    .prepare(
      `SELECT c.id, p.name AS project_name, c.title, c.category,
              c.tags, c.importance, c.times_used, c.content,
              c.project_id
       FROM contexts c
       JOIN projects p ON p.id = c.project_id
       WHERE c.id != ? AND c.deleted_at IS NULL
         AND (c.project_id = ? OR c.category = ?
              ${seedTags.length > 0 ? "OR " + seedTags.map(() => "c.tags LIKE ?").join(" OR ") : ""})`
    )
    .all(
      seedId,
      seed.project_id,
      seed.category,
      ...seedTags.map((t) => `%${t}%`)
    ) as Array<
    Omit<ContextSummary, "preview"> & {
      content: string;
      project_id: number;
    }
  >;

  const scored = candidates.map((row) => {
    const rowTags = row.tags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const sharedTags = rowTags.filter((t) => seedTags.includes(t)).length;
    let score = sharedTags * 2;
    if (row.project_id === seed.project_id) score += 1;
    if (row.category === seed.category) score += 1;
    return {
      id: row.id,
      project_name: row.project_name,
      title: row.title,
      category: row.category,
      tags: row.tags,
      importance: row.importance,
      times_used: row.times_used,
      preview: toPreview(row.content),
      score,
    };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.importance - a.importance)
    .slice(0, limit);
}

/**
 * Search sessions by summary/outcome substring. Simple LIKE match — the
 * sessions table is small and doesn't warrant a second FTS index.
 */
export function searchSessions(
  db: Database.Database,
  opts: { query?: string; project_name?: string; limit: number }
): Array<{
  id: number;
  project_name: string;
  summary: string;
  outcome: string;
  contexts_used: string;
  created_at: string;
}> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.query) {
    conditions.push("(s.summary LIKE ? OR s.outcome LIKE ?)");
    const pat = `%${opts.query}%`;
    params.push(pat, pat);
  }
  if (opts.project_name) {
    conditions.push("p.name = ?");
    params.push(opts.project_name);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(opts.limit);

  return db
    .prepare(
      `SELECT s.id, p.name AS project_name, s.summary, s.outcome,
              s.contexts_used, s.created_at
       FROM sessions s
       JOIN projects p ON p.id = s.project_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT ?`
    )
    .all(...params) as Array<{
    id: number;
    project_name: string;
    summary: string;
    outcome: string;
    contexts_used: string;
    created_at: string;
  }>;
}

/**
 * Find contexts that have times_used = 0 and are older than `olderThanDays`.
 */
export function findUnused(
  db: Database.Database,
  olderThanDays: number
): ContextSummary[] {
  const rows = db
    .prepare(
      `SELECT c.id, p.name AS project_name, c.title, c.category,
              c.tags, c.importance, c.times_used, c.content
       FROM contexts c
       JOIN projects p ON p.id = c.project_id
       WHERE c.deleted_at IS NULL
         AND c.times_used = 0
         AND c.created_at < datetime('now', ?)
       ORDER BY c.created_at ASC`
    )
    .all(`-${olderThanDays} days`) as Array<
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

// ── Backup / restore ────────────────────────────────────────────────

export interface HubExport {
  version: 1;
  exported_at: string;
  projects: ProjectRow[];
  contexts: Array<ContextRow & { tags_arr?: string[] }>;
  sessions: Array<{
    id: number;
    project_name: string;
    summary: string;
    contexts_used: string;
    outcome: string;
    created_at: string;
  }>;
}

export function exportHub(
  db: Database.Database,
  opts: { include_deleted: boolean }
): HubExport {
  const projects = db
    .prepare(
      `SELECT p.*, 0 AS context_count FROM projects p ORDER BY p.id`
    )
    .all() as ProjectRow[];

  const contextsSql = opts.include_deleted
    ? `SELECT c.*, p.name AS project_name FROM contexts c
       JOIN projects p ON p.id = c.project_id ORDER BY c.id`
    : `SELECT c.*, p.name AS project_name FROM contexts c
       JOIN projects p ON p.id = c.project_id
       WHERE c.deleted_at IS NULL ORDER BY c.id`;
  const contexts = db.prepare(contextsSql).all() as ContextRow[];

  const sessions = db
    .prepare(
      `SELECT s.id, p.name AS project_name, s.summary, s.contexts_used,
              s.outcome, s.created_at
       FROM sessions s
       JOIN projects p ON p.id = s.project_id
       ORDER BY s.id`
    )
    .all() as HubExport["sessions"];

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    projects,
    contexts,
    sessions,
  };
}

export function importHub(
  db: Database.Database,
  data: HubExport,
  mode: "merge" | "replace"
): { projects: number; contexts: number; sessions: number } {
  if (data.version !== 1) {
    throw new Error(
      `Unsupported export version: ${data.version}. This build supports v1.`
    );
  }

  const tx = db.transaction(() => {
    if (mode === "replace") {
      db.exec("DELETE FROM sessions");
      db.exec("DELETE FROM context_history");
      db.exec("DELETE FROM contexts");
      db.exec("DELETE FROM projects");
    }

    // Projects — get-or-create by name
    const projectIdByName = new Map<string, number>();
    for (const p of data.projects) {
      db.prepare(
        "INSERT OR IGNORE INTO projects (name, tech_stack, repo_path, description) VALUES (?, ?, ?, ?)"
      ).run(p.name, p.tech_stack, p.repo_path, p.description);
      const row = db
        .prepare("SELECT id FROM projects WHERE name = ?")
        .get(p.name) as { id: number };
      projectIdByName.set(p.name, row.id);
    }

    // Contexts
    let contextCount = 0;
    for (const c of data.contexts) {
      const pid = projectIdByName.get(c.project_name);
      if (!pid) continue;
      db.prepare(
        `INSERT INTO contexts (project_id, title, content, category, tags,
                               language, file_path, importance, times_used,
                               created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        pid,
        c.title,
        c.content,
        c.category,
        c.tags,
        c.language,
        c.file_path,
        c.importance,
        c.times_used,
        c.created_at,
        c.updated_at,
        c.deleted_at
      );
      contextCount++;
    }

    // Sessions
    let sessionCount = 0;
    for (const s of data.sessions) {
      const pid = projectIdByName.get(s.project_name);
      if (!pid) continue;
      db.prepare(
        `INSERT INTO sessions (project_id, summary, contexts_used, outcome, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(pid, s.summary, s.contexts_used, s.outcome, s.created_at);
      sessionCount++;
    }

    return {
      projects: projectIdByName.size,
      contexts: contextCount,
      sessions: sessionCount,
    };
  });

  return tx();
}
