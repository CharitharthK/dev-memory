# Contributing to Dev Memory

Thanks for your interest in contributing! This project is in active development and welcomes contributions of all kinds.

## Getting Started

```bash
git clone https://github.com/CharitharthK/dev-memory.git
cd dev-memory
npm install
npm run build
npm test
```

## Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Run tests (`npm test`) — all 52 tests must pass
5. Build (`npm run build`) — must compile with zero errors
6. Commit with a clear message
7. Push to your fork and open a Pull Request

## Code Guidelines

- **TypeScript strict mode** — no `any` types, no `@ts-ignore`
- **Zod validation** on all tool inputs — invalid data should never reach the database layer
- **Property-based tests** for new database operations — use fast-check with 100+ iterations
- **Error handling** — tool handlers must catch all errors and return MCP error responses (`isError: true`), never crash the server
- **Logging** — errors go to `console.error` (stderr), nothing goes to stdout (reserved for MCP protocol)

## Adding a New Tool

1. Add the Zod schema and TypeScript type to `src/types.ts`
2. Add the database function to `src/db.ts` with a proper return type (not `Record<string, unknown>`)
3. Create the tool handler in the appropriate `src/tools/` file
4. Register the tool in `src/server.ts` with a concise, factual description
5. Add property-based tests covering the round-trip behavior
6. Update the tool count in `test/integration.test.ts`

## What's Welcome

- Bug fixes
- Performance improvements (especially search/query optimization)
- New tool implementations from the [roadmap](README.md#roadmap)
- Test coverage improvements
- Documentation improvements
- MCP client configuration examples for new IDEs

## What to Discuss First

Open an issue before starting work on:

- New database tables or schema changes
- Changes to the search ranking algorithm
- New categories
- Breaking changes to tool interfaces

## Testing

```bash
# Run all tests
npm test

# Run a specific test file
npx vitest run test/search.test.ts

# Run tests in watch mode
npx vitest
```

## Questions?

Open an issue — happy to help.
