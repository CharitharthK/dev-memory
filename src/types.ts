import { z } from "zod";

// ── Shared MCP tool result type ──────────────────────────────────────
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// ── Row interfaces returned from the database layer ──────────────────
export interface ContextRow {
  id: number;
  project_id: number;
  title: string;
  content: string;
  category: string;
  tags: string;
  language: string;
  file_path: string;
  importance: number;
  times_used: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  project_name: string;
}

/** Lightweight search hit — content truncated to save tokens. */
export interface ContextSummary {
  id: number;
  project_name: string;
  title: string;
  category: string;
  tags: string;
  importance: number;
  times_used: number;
  /** First N characters of content, not the full blob. */
  preview: string;
}

export interface ProjectRow {
  id: number;
  name: string;
  tech_stack: string;
  repo_path: string;
  description: string;
  created_at: string;
  context_count: number;
}

export interface SessionRow {
  id: number;
  project_id: number;
  summary: string;
  contexts_used: string;
  outcome: string;
  created_at: string;
}

// ── Category enum ────────────────────────────────────────────────────
export const CategoryEnum = z.enum([
  "pattern",
  "decision",
  "gotcha",
  "snippet",
  "architecture",
  "prompt",
  "debug",
  "config",
  "general",
]);

export type Category = z.infer<typeof CategoryEnum>;

// ── Tool input schemas ───────────────────────────────────────────────

/**
 * Unified search — FTS5 query with optional filters.
 * `technology` replaces the old get_context_by_stack tool; when provided
 * without a query the search falls back to a tech-stack LIKE filter.
 */
export const SearchContextSchema = z.object({
  query: z.string().optional(),
  category: CategoryEnum.optional(),
  project_name: z.string().optional(),
  technology: z.string().optional(),
  limit: z.number().int().positive().optional().default(10),
});

export type SearchContextInput = z.infer<typeof SearchContextSchema>;

/** Fetch a single context entry by id (full content). */
export const GetContextSchema = z.object({
  id: z.number().int().positive(),
});

export type GetContextInput = z.infer<typeof GetContextSchema>;

export const SaveContextSchema = z.object({
  project_name: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  category: CategoryEnum,
  tags: z.string().optional(),
  language: z.string().optional(),
  file_path: z.string().optional(),
  importance: z.number().int().min(1).max(10).optional().default(5),
});

export type SaveContextInput = z.infer<typeof SaveContextSchema>;

/** Partial update — only provided fields are changed. */
export const UpdateContextSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  category: CategoryEnum.optional(),
  tags: z.string().optional(),
  language: z.string().optional(),
  file_path: z.string().optional(),
  importance: z.number().int().min(1).max(10).optional(),
});

export type UpdateContextInput = z.infer<typeof UpdateContextSchema>;

export const DeleteContextSchema = z.object({
  id: z.number().int().positive(),
});

export type DeleteContextInput = z.infer<typeof DeleteContextSchema>;

export const UpdateProjectSchema = z.object({
  name: z.string().min(1),
  tech_stack: z.string().optional(),
  description: z.string().optional(),
  repo_path: z.string().optional(),
});

export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

export const LogSessionSchema = z.object({
  project_name: z.string().min(1),
  summary: z.string().min(1),
  outcome: z.string().optional(),
  context_ids_used: z.array(z.number().int().positive()).optional(),
});

export type LogSessionInput = z.infer<typeof LogSessionSchema>;

// ── Scan / Bootstrap ─────────────────────────────────────────────────

export const ScanProjectSchema = z.object({
  repo_path: z.string().min(1),
  project_name: z.string().min(1).optional(),
});

export type ScanProjectInput = z.infer<typeof ScanProjectSchema>;

/** A single finding from a project scan. */
export interface ScanFinding {
  /** Suggested context category */
  category: string;
  /** Suggested context title */
  title: string;
  /** Extracted content to save */
  content: string;
  /** Suggested tags */
  tags: string;
  /** Detected language */
  language: string;
  /** Source file the finding came from */
  source_file: string;
  /** Suggested importance 1-10 */
  importance: number;
}

/** Structured output of a project scan. */
export interface ScanResult {
  project_name: string;
  repo_path: string;
  detected_tech_stack: string;
  directory_summary: string;
  findings: ScanFinding[];
}

// ── Trash & history ──────────────────────────────────────────────────

export const RestoreContextSchema = z.object({
  id: z.number().int().positive(),
});
export type RestoreContextInput = z.infer<typeof RestoreContextSchema>;

export const PurgeContextSchema = z.object({
  id: z.number().int().positive(),
});
export type PurgeContextInput = z.infer<typeof PurgeContextSchema>;

export const EmptyTrashSchema = z.object({
  /** Only purge entries that were soft-deleted more than N days ago. */
  older_than_days: z.number().int().nonnegative().optional().default(0),
});
export type EmptyTrashInput = z.infer<typeof EmptyTrashSchema>;

export const ListHistorySchema = z.object({
  id: z.number().int().positive(),
});
export type ListHistoryInput = z.infer<typeof ListHistorySchema>;

// ── Backup / restore ─────────────────────────────────────────────────

export const ExportHubSchema = z.object({
  /** Destination file path. Defaults to ./dev-memory-export.json in CWD. */
  file_path: z.string().min(1).optional(),
  /** Include soft-deleted entries. Default false. */
  include_deleted: z.boolean().optional().default(false),
});
export type ExportHubInput = z.infer<typeof ExportHubSchema>;

export const ImportHubSchema = z.object({
  file_path: z.string().min(1),
  /**
   * `merge` (default) keeps existing data and inserts entries from the
   * export as new rows. `replace` wipes the hub first.
   */
  mode: z.enum(["merge", "replace"]).optional().default("merge"),
});
export type ImportHubInput = z.infer<typeof ImportHubSchema>;

// ── Relations ────────────────────────────────────────────────────────

export const RelatedContextSchema = z.object({
  id: z.number().int().positive(),
  limit: z.number().int().positive().optional().default(5),
});
export type RelatedContextInput = z.infer<typeof RelatedContextSchema>;

// ── Sessions search / list ───────────────────────────────────────────

export const SearchSessionsSchema = z.object({
  query: z.string().optional(),
  project_name: z.string().optional(),
  limit: z.number().int().positive().optional().default(20),
});
export type SearchSessionsInput = z.infer<typeof SearchSessionsSchema>;

// ── Prune ────────────────────────────────────────────────────────────

export const PruneUnusedSchema = z.object({
  /** Only flag entries with times_used === 0 older than this. */
  older_than_days: z.number().int().positive().optional().default(90),
  /** When true, soft-deletes flagged entries. When false (default), returns them for review. */
  apply: z.boolean().optional().default(false),
});
export type PruneUnusedInput = z.infer<typeof PruneUnusedSchema>;

