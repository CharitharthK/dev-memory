# dev-memory — Cross-Project Dev Memory

## What It Is

dev-memory is a local MCP (Model Context Protocol) server built with Node.js and TypeScript that gives AI coding assistants persistent, cross-project memory. It stores knowledge — patterns, decisions, gotchas, snippets, architecture notes, debug insights, and more — in a single SQLite database and exposes it through 8 MCP tools over STDIO transport.

Any MCP-compatible client (Claude Desktop, Amazon Q Developer, VS Code with Copilot, Cursor, Amazon Kiro, etc.) can connect to it. You configure the server once per client, and all 8 tools are auto-discovered. The SQLite database at `~/.dev-memory/context.db` is shared across all clients, so knowledge saved from one IDE is available in every other.

## Why It Exists

AI coding assistants lose context between sessions and across projects. dev-memory solves this by:

- Letting the AI search for previously solved problems before writing new code
- Automatically saving new learnings (patterns, decisions, gotchas) after solving problems
- Tracking which knowledge gets reused most (via usage counters)
- Logging session activity for work history
- Maintaining technology stack consistency across projects

## Architecture

```
MCP Client (IDE / AI Assistant)
        ↕ MCP Protocol (JSON-RPC over STDIO)
dev-memory Process
  ├── StdioServerTransport (stdin/stdout)
  ├── McpServer (@modelcontextprotocol/sdk)
  ├── Tool Router → 8 Tool Handlers
  ├── Zod Validation (types.ts)
  └── Database Layer (db.ts) → better-sqlite3
        ↕
~/.dev-memory/context.db (SQLite + FTS5)
```

Single process, single database file, no network, no containers. Synchronous SQLite via better-sqlite3 keeps the code simple since MCP tool handlers are request/response.

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js ≥ 18 (ESM) |
| Language | TypeScript (strict mode, ES2022 target, NodeNext modules) |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Database | SQLite via `better-sqlite3` |
| Full-Text Search | SQLite FTS5 (synced via database triggers) |
| Validation | Zod |
| Testing | Vitest + fast-check (property-based testing) |

## Project Structure

```
dev-memory/
├── src/
│   ├── server.ts              # MCP server entry point, tool registration, STDIO transport
│   ├── db.ts                  # SQLite connection, schema DDL, all CRUD query functions
│   ├── types.ts               # Zod schemas, Category enum, TypeScript types
│   └── tools/
│       ├── search.ts          # search_context + get_context_by_stack handlers
│       ├── save.ts            # save_context + delete_context handlers
│       ├── projects.ts        # list_projects + update_project handlers
│       ├── sessions.ts        # log_session handler
│       └── stats.ts           # get_hub_stats handler
├── test/
│   ├── db.test.ts             # Database layer tests (Properties 1-3, 9)
│   ├── search.test.ts         # Search tool tests (Properties 4-7, 12-13)
│   ├── tools.test.ts          # Save/delete/projects/sessions/stats tests (Properties 8, 10-11, 14-16)
│   ├── validation.test.ts     # Zod validation tests (Property 18)
│   └── integration.test.ts    # MCP server integration tests (Property 17)
├── package.json
└── tsconfig.json
```

## Database Schema

5 tables in SQLite:

### projects
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| name | TEXT UNIQUE | Project identifier |
| tech_stack | TEXT | e.g. "typescript, react, postgresql" |
| repo_path | TEXT | Local path to repo |
| description | TEXT | Project description |
| created_at | TEXT | ISO 8601 timestamp |

### contexts
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| project_id | INTEGER FK → projects | |
| title | TEXT | Searchable title |
| content | TEXT | Full knowledge content |
| category | TEXT | One of 9 categories (see below) |
| tags | TEXT | Comma-separated tags |
| language | TEXT | Programming language |
| file_path | TEXT | Relevant file path |
| importance | INTEGER | 1-10, default 5 |
| times_used | INTEGER | Usage counter, default 0 |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

### sessions
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| project_id | INTEGER FK → projects | |
| summary | TEXT | What was done |
| contexts_used | TEXT | JSON array of context IDs |
| outcome | TEXT | e.g. "resolved", "in progress" |
| created_at | TEXT | ISO 8601 |

### context_relations
| Column | Type | Notes |
|---|---|---|
| context_a | INTEGER FK → contexts | ON DELETE CASCADE |
| context_b | INTEGER FK → contexts | ON DELETE CASCADE |
| relation_type | TEXT | `related`, `supersedes`, or `conflicts` |

### contexts_fts (FTS5 virtual table)
Indexes `title`, `content`, `tags`, `category` from the contexts table. Kept in sync via three database triggers (INSERT, UPDATE, DELETE).

## Categories

9 categories for context entries:

| Category | Use For |
|---|---|
| `pattern` | Reusable coding approaches, design patterns |
| `decision` | Technology choices, architecture decisions with rationale |
| `gotcha` | Bugs, pitfalls, non-obvious behaviors, workarounds |
| `snippet` | Reusable code blocks, templates, boilerplate |
| `architecture` | System design, component structure, data flow |
| `prompt` | Effective AI prompts, prompt engineering techniques |
| `debug` | Debugging techniques, diagnostic steps |
| `config` | Environment setup, tool configuration, deployment |
| `general` | Anything that doesn't fit the above |

## The 8 MCP Tools

### 1. `search_context`
Full-text search across all knowledge entries using FTS5.

**Parameters:**
- `query` (string, required) — Search terms
- `category` (string, optional) — Filter by category
- `project_name` (string, optional) — Filter by project
- `limit` (number, optional, default: 10) — Max results

**Behavior:** Searches FTS5 index, returns matches ordered by relevance, increments `times_used` on each returned entry.

### 2. `save_context`
Save a new knowledge entry to the hub.

**Parameters:**
- `project_name` (string, required) — Auto-creates project if it doesn't exist
- `title` (string, required)
- `content` (string, required)
- `category` (string, required) — Must be one of the 9 categories
- `tags` (string, optional) — Comma-separated
- `language` (string, optional)
- `file_path` (string, optional)
- `importance` (number, optional, default: 5) — 1-10 scale

**Behavior:** Validates input via Zod, auto-creates project if needed, inserts context, returns new ID.

### 3. `delete_context`
Delete an outdated or incorrect entry.

**Parameters:**
- `id` (number, required) — Context entry ID

**Behavior:** Deletes the entry and its FTS5 index row (via trigger). Returns not-found if ID doesn't exist.

### 4. `list_projects`
List all projects with context counts.

**Parameters:** None

**Behavior:** LEFT JOINs projects with contexts, returns each project with its context count.

### 5. `update_project`
Update project metadata.

**Parameters:**
- `name` (string, required) — Project to update
- `tech_stack` (string, optional)
- `description` (string, optional)
- `repo_path` (string, optional)

**Behavior:** Partial update — only provided fields are changed. Returns not-found if project doesn't exist.

### 6. `get_context_by_stack`
Find knowledge from projects using a specific technology.

**Parameters:**
- `technology` (string, required) — e.g. "react", "postgresql"
- `limit` (number, optional, default: 20)

**Behavior:** Case-insensitive LIKE search on `projects.tech_stack`, returns contexts ordered by importance desc, then times_used desc.

### 7. `get_hub_stats`
Get overall hub statistics.

**Parameters:** None

**Returns:** Total projects, total contexts, category breakdown, top 5 most-used entries, 5 most recent entries.

### 8. `log_session`
Log a coding session.

**Parameters:**
- `project_name` (string, required) — Auto-creates project if needed
- `summary` (string, required)
- `outcome` (string, optional)
- `context_ids_used` (number[], optional) — IDs of contexts referenced

**Behavior:** Stores context_ids_used as JSON string. Auto-creates project if needed.

## Intended Automation Behavior

The system is designed to run hands-free. The AI assistant should automatically:

1. **On every user message:** Extract keywords and call `search_context` + `get_context_by_stack` to load relevant knowledge before responding. Silently incorporate results — don't ask the user.
2. **After solving a problem:** Automatically call `save_context` with appropriate category, tags, and importance. Briefly mention what was saved.
3. **When a session ends:** Automatically call `log_session` with a summary, outcome, and any context IDs used or created.
4. **When encountering errors:** Search for `gotcha` entries before debugging from scratch.
5. **When making tech decisions:** Save the rationale via `save_context` with category `decision`.

This behavior can be enforced via system prompts, IDE hooks, or agent configuration depending on the client.

## Validation

All tool inputs are validated with Zod schemas before any database access. Invalid inputs get a descriptive error response. The `category` field is validated against the 9-value enum. `importance` is constrained to 1-10 at both the Zod and SQLite CHECK constraint levels.

## Error Handling

Every tool handler wraps its logic in try/catch. Errors return MCP error responses (with `isError: true`) containing the tool name, parameters, and error message. The server never crashes on a tool call failure. All error logging goes to stderr. Zero non-protocol output goes to stdout.

Database initialization failures (can't create directory or file) cause the process to exit with a non-zero code since the server can't function without a database.

## Testing

41 tests across 5 files, using Vitest + fast-check for property-based testing.

### 18 Correctness Properties

| # | Property | What It Proves |
|---|---|---|
| 1 | Save-then-search round-trip | Saved entries are findable via FTS with all fields intact |
| 2 | Save-then-delete FTS cleanup | Deleted entries disappear from FTS index |
| 3 | FTS update synchronization | Updated content is searchable, old content is not |
| 4 | Search category filter | Category filter returns only matching categories |
| 5 | Search project filter | Project filter returns only matching projects |
| 6 | Result limit enforcement | Result count ≤ specified limit |
| 7 | Search increments usage counter | times_used increases by 1 for each returned entry |
| 8 | Auto-create project on save/log | New project names auto-create project records |
| 9 | Default importance | Entries saved without importance get value 5 |
| 10 | Accurate project context counts | list_projects counts match actual records |
| 11 | Partial update preserves fields | Only specified fields change on update |
| 12 | Stack search matches tech_stack | Results come only from projects with matching tech_stack |
| 13 | Stack search ordering | Results ordered by importance desc, times_used desc |
| 14 | Hub stats counts accuracy | Counts match actual records, category breakdown sums to total |
| 15 | Hub stats ordering | Top-used ordered by times_used desc, recent by created_at desc |
| 16 | Session logging round-trip | Session fields stored correctly including JSON context_ids_used |
| 17 | Error handling returns MCP error | Database errors produce error responses, not crashes |
| 18 | Zod validation rejects invalid input | Invalid params rejected before DB access |

All property tests run with 100+ iterations of randomly generated inputs via fast-check.

## How to Build and Run

```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Run tests
npm test

# Run the server directly
node dist/server.js
```

## MCP Client Configuration

Add this to your MCP client's configuration file:

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

One config entry per client. All 8 tools are auto-discovered via the MCP protocol. The database is shared across all clients.

## Importance Scale Reference

| Range | Label | Examples |
|---|---|---|
| 8–10 | Critical | Security fixes, breaking change workarounds, cross-system architecture decisions, production incident resolutions |
| 5–7 | Useful | Reusable patterns, common configs, debugging techniques, integration approaches |
| 1–4 | Minor | One-off fixes, style preferences, temporary workarounds, niche edge cases |
