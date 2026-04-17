# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-17

Initial public release.

### MCP tools (20)

**Search & retrieve**

- `search_context` — FTS5 full-text search with optional `category`, `project_name`, `technology` filters. Returns summaries (title + 180-char preview) instead of full content to keep the AI's context window lean.
- `get_context` — fetch full content by id. This is the only place usage counters increment, so analytics reflect entries the AI actually consumed.
- `related_context` — surface entries related to a seed by shared tags, project, and category. Scored: shared tag = 2, same project = 1, same category = 1.
- `search_sessions` — search logged sessions by summary/outcome substring, with optional project filter.

**Create / update / delete**

- `save_context` — auto-creates the project if it doesn't exist.
- `update_context` — partial update; only provided fields change, preserving ID and usage history.
- `delete_context` — soft-delete (sets `deleted_at`). Recoverable.
- `restore_context` — un-delete an entry from the trash.
- `purge_context` — permanent delete bypassing the trash (also removes history).
- `empty_trash` — permanently remove all trashed entries older than `older_than_days`.
- `list_trash` — browse soft-deleted entries.

**History (versioning)**

- `list_history` — show the edit timeline for a context. Every meaningful update snapshots the prior row via a SQLite trigger.

**Projects**

- `list_projects` — list projects with their (non-deleted) context counts.
- `update_project` — set `tech_stack`, `description`, or `repo_path`.

**Sessions & stats**

- `log_session` — record a coding session with summary, outcome, and context IDs used.
- `get_hub_stats` — aggregate stats: counts, category breakdown, top used, most recent, and trash count.

**Bootstrap & maintenance**

- `scan_project` — inspect a project directory and suggest entries to save. Never auto-saves.
- `export_hub` — write the entire hub to a JSON file (projects, contexts, sessions).
- `import_hub` — load a JSON export. `mode: "merge"` (default) keeps existing data; `mode: "replace"` wipes first.
- `prune_unused` — surface entries with `times_used = 0` older than N days. Dry-run by default; pass `apply: true` to soft-delete.

### Architecture & design

- **SQLite + FTS5** with BM25 ranking. Column weights: title × 10, tags × 5, category × 3, content × 1.
- **Two-phase search** — summaries on search, full content only on `get_context`. Avoids flooding the context window with content the AI will discard.
- **WAL journaling** — concurrent reads don't block on writes.
- **Soft-delete + history triggers** — `deleted_at` column hides rows from every read path by default; a `BEFORE UPDATE` trigger on meaningful field changes snapshots the old row into `context_history`.
- **Forward-only migrations** — `initDb` runs `PRAGMA table_info` and adds missing columns so existing databases upgrade transparently.
- **FTS5 query sanitization** — special operators stripped, tokens double-quoted, implicit AND between them. Safe for natural-language input.
- **`DEV_MEMORY_DB_PATH`** environment variable to override the default `~/.dev-memory/context.db`.

### Web viewer

- Dashboard (stats, category chart, most-used)
- Contexts browser (FTS search with filters)
- Projects list, sessions history, trash view
- Per-entry edit-history drawer
- **Per-run auth token** printed at startup; override with `DEV_MEMORY_TOKEN` or disable with `--no-auth`

### Testing

Property-based tests via Vitest + fast-check. Each property runs 100+ random iterations covering save/search round-trips, FTS sync on update/delete, category/project/limit filters, usage counter accuracy, soft-delete semantics, history capture, related-context scoring, and export/import round-trips.

### Packaging

- Installable via `npx dev-memory`. `bin` entries for `dev-memory` and `dev-memory-viewer`.
- `files` whitelist so the published tarball contains only `dist/`, `steering/`, and docs.
- `prepublishOnly` runs `build` + tests.
- Requires Node.js ≥ 18.
