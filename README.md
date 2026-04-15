# Dev Memory

**Persistent, cross-project memory for AI coding assistants.**

Dev Memory is a local [MCP](https://modelcontextprotocol.io/) server that gives AI coding assistants long-term memory across projects and sessions. It stores patterns, decisions, gotchas, snippets, and architecture notes in a SQLite database and exposes them through 10 MCP tools.

Save a solution once, reuse it everywhere — across projects, IDEs, and sessions.

## The Problem

AI coding assistants lose everything between sessions. You explain the same architecture decisions, re-debug the same gotchas, and re-discover the same patterns over and over. Knowledge stays trapped in individual chat histories instead of compounding over time.

## How It Works

```
MCP Client (IDE / AI Assistant)
        ↕ MCP Protocol (JSON-RPC over STDIO)
Dev Memory Server
  ├── 9 MCP Tools (search, save, update, ...)
  ├── Zod Validation
  └── SQLite + FTS5 Full-Text Search
        ↕
~/.dev-memory/context.db  ← shared across all clients
```

Single process. Single database file. No network. No containers. No API keys.

The AI assistant automatically searches the hub before responding, saves new knowledge after solving problems, and logs session activity. One config entry per IDE — all 10 tools are auto-discovered.

### Two-Phase Search (Token Efficient)

Search returns **summaries** (title, category, 180-char preview) — not full content. The AI only fetches full entries for results it actually needs via `get_context(id)`. This avoids flooding the context window with content the AI would scan and discard.

```
User asks about React hydration errors
  → search_context("react hydration") → 3 summaries returned (~200 tokens)
  → AI reads summaries, picks the relevant one
  → get_context(42) → full content for that entry (~500 tokens)
  → AI incorporates the solution

Without two-phase: all 3 full entries → ~1500 tokens, most unused
```

### Project Bootstrap (Cold Start)

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

## Quick Start

```bash
# Clone and build
git clone https://github.com/CharitharthK/dev-memory.git
cd dev-memory
npm install
npm run build

# Run tests (optional — 52 tests)
npm test

# The server runs via STDIO — configure your MCP client below
```

**Requirements:** Node.js ≥ 18

## Web Viewer

Dev Memory includes a lightweight web UI for browsing your knowledge base. Zero extra dependencies — just Node's built-in `http` module.

```bash
npm run viewer           # opens at http://localhost:3333
npm run viewer -- --port 8080   # custom port
```

The viewer provides:

- **Dashboard** — stats overview, category breakdown chart, most-used entries
- **Contexts** — full-text search with category/project/technology filters, click to view full content
- **Projects** — browse all projects, click to filter their contexts
- **Sessions** — session history with outcomes and context references

### Seed Demo Data

To try the viewer with sample data before you've built up your own knowledge base:

```bash
node examples/seed-demo.js
npm run viewer
```

## MCP Client Configuration

Add Dev Memory to your MCP client's config file. All 10 tools are auto-discovered.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

### VS Code (Copilot / Continue)

Add to your MCP settings:

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

### Cursor

Add to `.cursor/mcp.json` in your project root:

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

### Amazon Q Developer / Kiro

Add to your MCP configuration file:

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

The database at `~/.dev-memory/context.db` is shared across all clients. Knowledge saved from one IDE is available in every other.

## Steering (Optional)

Copy `steering/dev-memory-usage.md` into your IDE's steering/rules directory to guide the AI on when to search, save, and log sessions. This is optional — the tools work without it — but it makes the AI's behavior more consistent.

## The 9 Tools

### Search & Retrieve

| Tool             | Description                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `search_context` | Full-text search with optional `category`, `project_name`, `technology` filters. Returns summaries. |
| `get_context`    | Fetch full content for a single entry by ID. Increments usage counter.                              |

### Create / Update / Delete

| Tool             | Description                                                                          |
| ---------------- | ------------------------------------------------------------------------------------ |
| `save_context`   | Save a new knowledge entry. Auto-creates the project if it doesn't exist.            |
| `update_context` | Partial update — only provided fields change. Preserves ID, usage count, timestamps. |
| `delete_context` | Delete an entry by ID.                                                               |

### Projects

| Tool             | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `list_projects`  | List all projects with tech stacks and context counts.    |
| `update_project` | Update a project's tech_stack, description, or repo_path. |

### Stats & Sessions

| Tool            | Description                                                         |
| --------------- | ------------------------------------------------------------------- |
| `get_hub_stats` | Aggregate stats: counts, category breakdown, top used, most recent. |
| `log_session`   | Log a coding session with summary, outcome, and context IDs used.   |

### Bootstrap

| Tool           | Description                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `scan_project` | Scan a project directory to detect tech stack, config, and structure. Returns findings for user review — does NOT auto-save. |

## Categories

Each knowledge entry is tagged with one of 9 categories:

| Category       | Use For                                                   |
| -------------- | --------------------------------------------------------- |
| `pattern`      | Reusable coding approaches, design patterns               |
| `decision`     | Technology choices, architecture decisions with rationale |
| `gotcha`       | Bugs, pitfalls, non-obvious behaviors, workarounds        |
| `snippet`      | Reusable code blocks, templates, boilerplate              |
| `architecture` | System design, component structure, data flow             |
| `prompt`       | Effective AI prompts, prompt engineering techniques       |
| `debug`        | Debugging techniques, diagnostic steps                    |
| `config`       | Environment setup, tool configuration, deployment         |
| `general`      | Anything that doesn't fit the above                       |

## Tech Stack

| Component        | Technology                                |
| ---------------- | ----------------------------------------- |
| Runtime          | Node.js ≥ 18 (ESM)                        |
| Language         | TypeScript (strict mode)                  |
| MCP SDK          | `@modelcontextprotocol/sdk`               |
| Database         | SQLite via `better-sqlite3` (synchronous) |
| Full-Text Search | SQLite FTS5 with BM25 ranking             |
| Validation       | Zod                                       |
| Testing          | Vitest + fast-check (property-based)      |

## Project Structure

```
dev-memory/
├── src/
│   ├── server.ts          # MCP server, tool registration, STDIO transport
│   ├── viewer.ts          # Web UI — lightweight DB browser
│   ├── db.ts              # SQLite schema, all CRUD functions
│   ├── types.ts           # Zod schemas, TypeScript interfaces
│   └── tools/
│       ├── search.ts      # search_context + get_context
│       ├── save.ts        # save_context + update_context + delete_context
│       ├── projects.ts    # list_projects + update_project
│       ├── sessions.ts    # log_session
│       ├── stats.ts       # get_hub_stats
│       └── scan.ts        # scan_project (bootstrap)
├── test/                  # 52 tests
├── examples/              # Demo seed script
├── steering/              # AI behavioral rules (optional)
├── package.json
└── tsconfig.json
```

## Testing

52 tests across 5 files using Vitest + fast-check for property-based testing. Each property runs 100+ iterations with randomly generated inputs.

```bash
npm test
```

Key properties tested: save/search round-trips, FTS sync on update/delete, category and project filters, result limit enforcement, usage counter accuracy, partial update field preservation, stats aggregation, session logging, error handling (graceful MCP error responses, no crashes), and Zod validation for all tool inputs.

## Design Decisions

**SQLite FTS5 over vector search.** For code knowledge retrieval, keyword matching with BM25 ranking outperforms embedding similarity. "React hydration error" should find entries about React hydration errors, not semantically similar but unrelated content about "Vue rendering issues." FTS5 is also zero-dependency, runs in-process, and requires no embedding model.

**Two-phase search over full retrieval.** The v1 design returned full content for every search hit and incremented usage counters on search. This wasted tokens (the AI scans and discards most results) and inflated usage metrics. v2 returns summaries and only fetches/tracks entries the AI actually uses.

**Selective search over search-on-every-message.** The v1 steering rules instructed the AI to search on every user message. This added 2 tool calls to every turn, even for trivial actions. v2 guides the AI to search only when it would change the response — debugging, implementing patterns, making decisions.

**`update_context` over delete-and-resave.** Preserves the entry's ID, usage history, and any session references. Essential for knowledge that evolves over time.

## Roadmap

- [ ] Cross-project flow documentation (trace features across services)
- [ ] Meeting prep / requirement gap analyzer
- [ ] Dependency graph and impact tracing
- [ ] Context versioning (decision evolution timeline)
- [ ] Template-driven document generation (ADRs, runbooks)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
