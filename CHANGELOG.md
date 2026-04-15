# Changelog

## [2.0.0] - 2025-XX-XX

### Architecture

- **Two-phase search** — `search_context` returns summaries (180-char previews), `get_context` fetches full content on demand. Reduces per-search token cost by ~60%.
- **Merged `get_context_by_stack` into `search_context`** — the `technology` parameter replaces the standalone tool, eliminating one tool definition and one call per turn.
- **Usage tracking moved to `get_context` only** — search no longer writes to the database, eliminating wasted UPDATE queries on results the AI never reads.
- **FTS5 query sanitization** — special characters are stripped and tokens are double-quoted for safe implicit AND. Prevents query syntax errors from natural language input.
- **BM25 column weighting** — title (10x), tags (5x), category (3x), content (1x). Title matches rank significantly higher.

### New Tools

- `get_context` — fetch full content for a single entry by ID (the second phase of two-phase search)
- `update_context` — partial update of existing entries, preserving ID, usage count, and session references
- `scan_project` — scan a project directory to bootstrap the knowledge base (user reviews findings before saving)

### New Features

- **Web Viewer** — lightweight browser UI for browsing the knowledge base (`npm run viewer`). Dashboard with stats, full-text search with filters, context detail view, project and session browsers. Zero new dependencies — built with Node's built-in `http` module.
- **Project Bootstrap (`scan_project`)** — scans a project directory to detect tech stack, config files, CI/CD pipelines, directory structure, and README. Returns structured findings for the user to review and selectively save. Solves the cold-start problem for new projects.
- **Demo seed script** — `node examples/seed-demo.js` populates the database with 12 realistic contexts across 4 projects for demo and evaluation purposes.

### Improvements

- Shared `ToolResult` type (was duplicated across 5 files)
- Proper TypeScript interfaces (`ContextRow`, `ContextSummary`, `ProjectRow`) replacing `Record<string, unknown>`
- Database indexes on `project_id`, `category`, `importance/times_used`
- Slim tool descriptions — behavioral instructions moved to steering docs
- Consolidated steering from 2 files to 1, changed strategy from "search every message" to "search when it would change your response"
- Removed unused `context_relations` table

### Testing

- 52 tests (up from 41)
- New properties: `getContextById` round-trip, usage increment on fetch only, `updateContext` partial update preservation

### Breaking Changes

- `get_context_by_stack` tool removed — use `search_context` with the `technology` parameter instead
- `search_context` now returns `ContextSummary[]` (with `preview` field) instead of full content rows
- Usage counters no longer increment on search — only on `get_context`

## [1.0.0] - 2025-XX-XX

Initial release with 8 MCP tools: search_context, save_context, delete_context, list_projects, update_project, get_context_by_stack, get_hub_stats, log_session.
