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

