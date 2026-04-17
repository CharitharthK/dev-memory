# Dev Memory

**Persistent, cross-project memory for AI coding assistants.**

Dev Memory is a local [MCP](https://modelcontextprotocol.io/) server that gives AI coding assistants long-term memory across projects and sessions. It stores patterns, decisions, gotchas, snippets, and architecture notes in a SQLite database and exposes them through **20 MCP tools**.

Save a solution once, reuse it everywhere — across projects, IDEs, and sessions.

## The problem

AI coding assistants lose everything between sessions. You explain the same architecture decisions, re-debug the same gotchas, and re-discover the same patterns over and over. Knowledge stays trapped in individual chat histories instead of compounding over time.

## How it works

```
MCP Client (IDE / AI Assistant)
        ↕ MCP Protocol (JSON-RPC over STDIO)
Dev Memory Server
  ├── 20 MCP tools (search, save, related, history, backup, …)
  ├── Zod validation
  └── SQLite + FTS5 full-text search + WAL
        ↕
~/.dev-memory/context.db (shared across all clients)
```

Single process. Single database file. No network. No containers. No API keys.

The AI searches the hub before answering, saves new knowledge after solving problems, and logs session activity. One config entry per IDE — all 20 tools are auto-discovered.

### Two-phase search (token-efficient)

Search returns **summaries** (title, category, 180-char preview) — not full content. The AI only fetches full entries for results it actually needs via `get_context(id)`. This avoids flooding the context window with content the AI would scan and discard.

```
User asks about React hydration errors
  → search_context("react hydration")  → 3 summaries (~200 tokens)
  → AI reads summaries, picks the relevant one
  → get_context(42)                    → full content (~500 tokens)
  → AI incorporates the solution

Without two-phase: all 3 full entries → ~1500 tokens, most unused
```

### Soft delete + edit history

- `delete_context` moves entries to a **trash** (sets `deleted_at`). They vanish from search but can be brought back with `restore_context`. Use `purge_context` or `empty_trash` to delete permanently.
- Every meaningful edit (title, content, category, tags, importance) snapshots the prior row into a `context_history` table via a SQLite trigger. View the timeline with `list_history(id)`.

### Project bootstrap (cold start)

New project with an empty knowledge base? The `scan_project` tool reads your repo and detects config, tech stack, and structure — then lets you choose what to save:

```
User: "Bootstrap this project"
  → AI calls scan_project({ repo_path: "/path/to/project" })
  → Reads package.json, Dockerfile, CI configs, directory structure
  → Returns: "Found 8 items — tech stack, npm scripts, env vars, ..."
  → AI: "Here's what I found. Want me to save all, some, or none?"
  → User picks items → AI calls save_context for each approved one
```

The scan never auto-saves — the user always reviews and approves.

## Quick start

### Install from npm

Once published, the preferred setup is:

```bash
npx dev-memory          # starts the MCP server on STDIO
npx dev-memory-viewer   # starts the web viewer
```

### Build from source

```bash
git clone https://github.com/CharitharthK/dev-memory.git
cd dev-memory
npm install
npm run build
npm test   # optional — property-based test suite
```

**Requirements:** Node.js ≥ 18.

## MCP client configuration

Add Dev Memory to your MCP client's config file. All 20 tools are auto-discovered.

### Via npx (after publishing)

```json
{
  "mcpServers": {
    "dev-memory": {
      "command": "npx",
      "args": ["dev-memory"]
    }
  }
}
```

### From a local build

```json
{
  "mcpServers": {
    "dev-memory": {
      "command": "node",
      "args": ["/absolute/path/to/dev-memory/dist/server.js"]
    }
  }
}
```

### Config file locations

| Client                        | Path                                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| Claude Desktop (macOS)        | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows)      | `%APPDATA%\Claude\claude_desktop_config.json`                    |
| Cursor                        | `.cursor/mcp.json` (per project)                                 |
| VS Code (Copilot / Continue)  | MCP settings in your extension config                             |
| Amazon Q Developer / Kiro     | MCP configuration file in the client settings                     |

The database at `~/.dev-memory/context.db` is shared across all clients. Knowledge saved from one IDE is available in every other.

## Environment variables

| Variable             | Default                         | Purpose                                                                |
| -------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `DEV_MEMORY_DB_PATH` | `~/.dev-memory/context.db`      | Override the SQLite file path (use `:memory:` for an ephemeral DB).    |
| `DEV_MEMORY_TOKEN`   | auto-generated per run          | Required query-string token for the web viewer. Use `--no-auth` to skip. |

## Web viewer

A lightweight web UI for browsing your knowledge base. Zero extra runtime dependencies — just Node's built-in `http` module.

```bash
npm run viewer                  # opens at http://localhost:3333?token=...
npm run viewer -- --port 8080   # custom port
npm run viewer -- --no-auth     # disable the token (local dev only)
DEV_MEMORY_TOKEN=secret npm run viewer   # use your own token
```

By default the viewer generates a fresh random token at startup and prints the full URL. Bookmark the URL while the server is running, or set `DEV_MEMORY_TOKEN` to something stable.

Features:

- **Dashboard** — stats overview, category breakdown chart, most-used entries, trash count.
- **Contexts** — full-text search with category/project/technology filters, click to view full content and edit history.
- **Projects** — browse all projects, click to filter their contexts.
- **Sessions** — session history with outcomes and context references.
- **Trash** — review soft-deleted entries.

### Seed demo data

```bash
node examples/seed-demo.js
npm run viewer
```

## Steering (optional)

Copy `steering/dev-memory-usage.md` into your IDE's steering/rules directory to guide the AI on when to search, save, and log sessions. This is optional — the tools work without it — but it makes the AI's behaviour more consistent.

## The 20 tools

### Search & retrieve

| Tool               | Description                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `search_context`   | Full-text search with optional `category`, `project_name`, `technology` filters. Returns summaries.      |
| `get_context`      | Fetch full content for a single entry by id. Increments the usage counter.                               |
| `related_context`  | Find entries related to a seed by shared tags (×2), project (×1), and category (×1). Ranked.             |
| `search_sessions`  | Search logged sessions by summary/outcome substring, with optional `project_name` filter.                 |

### Create / update / delete

| Tool              | Description                                                                             |
| ----------------- | --------------------------------------------------------------------------------------- |
| `save_context`    | Save a new knowledge entry. Auto-creates the project if it doesn't exist.               |
| `update_context`  | Partial update — only provided fields change. Captures a history row.                   |
| `delete_context`  | **Soft-delete** — moves the entry to the trash. Recoverable.                            |
| `restore_context` | Un-delete an entry from the trash.                                                      |
| `purge_context`   | Permanent delete (bypasses the trash, also removes its history).                        |
| `empty_trash`     | Permanently remove trashed entries older than `older_than_days` (default 0 = all).      |
| `list_trash`      | List soft-deleted entries (most recently trashed first).                                |

### History

| Tool           | Description                                                               |
| -------------- | ------------------------------------------------------------------------- |
| `list_history` | Show the edit timeline for a context. Newest revision first.              |

### Projects

| Tool             | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `list_projects`  | List all projects with tech stacks and context counts.    |
| `update_project` | Update a project's `tech_stack`, `description`, or `repo_path`. |

### Stats & sessions

| Tool            | Description                                                                 |
| --------------- | --------------------------------------------------------------------------- |
| `get_hub_stats` | Aggregate stats: counts, category breakdown, top used, most recent, trash count. |
| `log_session`   | Log a coding session with summary, outcome, and context IDs used.           |

### Bootstrap & maintenance

| Tool           | Description                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `scan_project` | Scan a project directory to detect tech stack, config, and structure. Returns findings for user review — does NOT auto-save. |
| `export_hub`   | Write the full hub (projects, contexts, sessions) to a JSON file. Use for backup or migration.                               |
| `import_hub`   | Load a hub export. `mode: "merge"` (default) keeps existing data; `mode: "replace"` wipes first.                             |
| `prune_unused` | Find or soft-delete entries with `times_used = 0` older than N days. Dry-run by default; pass `apply: true` to delete.       |

## Categories

Each knowledge entry is tagged with one of 9 categories:

| Category       | Use for                                                   |
| -------------- | --------------------------------------------------------- |
| `pattern`      | Reusable coding approaches, design patterns               |
| `decision`     | Technology choices, architecture decisions with rationale |
| `gotcha`       | Bugs, pitfalls, non-obvious behaviours, workarounds       |
| `snippet`      | Reusable code blocks, templates, boilerplate              |
| `architecture` | System design, component structure, data flow             |
| `prompt`       | Effective AI prompts, prompt-engineering techniques       |
| `debug`        | Debugging techniques, diagnostic steps                    |
| `config`       | Environment setup, tool configuration, deployment         |
| `general`      | Anything that doesn't fit the above                       |

## Tech stack

| Component        | Technology                                |
| ---------------- | ----------------------------------------- |
| Runtime          | Node.js ≥ 18 (ESM)                        |
| Language         | TypeScript (strict mode)                  |
| MCP SDK          | `@modelcontextprotocol/sdk`               |
| Database         | SQLite via `better-sqlite3` (synchronous) |
| Full-text search | SQLite FTS5 with BM25 ranking             |
| Validation       | Zod                                       |
| Testing          | Vitest + fast-check (property-based)      |

## Project structure

```
dev-memory/
├── src/
│   ├── server.ts          # MCP server, tool registration, STDIO transport
│   ├── viewer.ts          # Web UI — lightweight DB browser
│   ├── db.ts              # SQLite schema, migrations, all CRUD + search
│   ├── types.ts           # Zod schemas, TypeScript interfaces
│   └── tools/
│       ├── search.ts      # search_context + get_context
│       ├── save.ts        # save_context + update_context + delete_context
│       ├── trash.ts       # restore, purge, empty_trash, list_trash
│       ├── history.ts     # list_history
│       ├── related.ts     # related_context
│       ├── backup.ts      # export_hub + import_hub
│       ├── prune.ts       # prune_unused
│       ├── projects.ts    # list_projects + update_project
│       ├── sessions.ts    # log_session + search_sessions
│       ├── stats.ts       # get_hub_stats
│       └── scan.ts        # scan_project
├── test/                  # property-based test suite
├── examples/              # demo seed script
├── steering/              # AI behavioural rules (optional)
├── package.json
├── tsconfig.json
├── DESIGN.md
└── CHANGELOG.md
```

## Design decisions

**SQLite FTS5 over vector search.** For code knowledge retrieval, keyword matching with BM25 ranking outperforms embedding similarity. "React hydration error" should find entries about React hydration errors, not semantically similar but unrelated content about "Vue rendering issues." FTS5 is also zero-dependency, runs in-process, and requires no embedding model.

**Two-phase search over full retrieval.** Returning summaries (not full content) on search and only fetching/tracking entries the AI actually reads avoids wasted tokens and inflated usage metrics.

**Selective search over search-on-every-message.** The steering rules guide the AI to search only when it would change the response — debugging, implementing patterns, making decisions — not on every turn.

**Soft-delete by default.** A knowledge base that destroys data on a fat-fingered tool call is not a knowledge base. `delete_context` is recoverable; `purge_context` exists for when permanent removal is genuinely wanted.

**History via triggers, not application code.** The `BEFORE UPDATE` trigger on `contexts` is the single source of truth — you can't forget to record a version from the app side, and it works even for direct SQL edits.

**Synchronous `better-sqlite3`.** STDIO servers are single-threaded by nature, so async DB ops buy you nothing but callback complexity. Synchronous reads simplify the MCP handler code.

**WAL journaling.** Concurrent reads don't block on writes — important when a single MCP session fires multiple tool calls in parallel.

## Roadmap

- [x] Soft delete, trash, recovery
- [x] Context versioning (decision-evolution timeline)
- [x] Dependency graph v1 (`related_context` by tag/project/category overlap)
- [x] Backup / migration (`export_hub`, `import_hub`)
- [x] Data hygiene (`prune_unused`)
- [ ] Cross-project flow documentation (trace a feature across services)
- [ ] Meeting-prep / requirement gap analyser
- [ ] Template-driven document generation (ADRs, runbooks)
- [ ] Explicit context-link graph (beyond tag/project overlap)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
