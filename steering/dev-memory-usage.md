---
inclusion: always
---

# Dev Memory — Behavioral Rules

The Cross-Project Dev Memory (dev-memory) provides persistent memory across projects and sessions. These rules govern when and how to use it efficiently.

## When to Search (Selective, Not Every Message)

Search the hub when the user's message involves:

- Debugging an error or unexpected behavior
- Implementing a pattern, integration, or architectural component
- Making a technology or design decision
- Working with a specific framework/library where prior knowledge may exist
- Any task where reusing existing knowledge would save effort

Do NOT search for trivial actions like renaming variables, adding log lines, formatting, or answering general knowledge questions. If a search would not change your response, skip it.

When you do search, use a single `search_context` call with relevant filters (query, category, technology). The tool returns summaries. Only call `get_context(id)` for entries you will actually use — this is where the usage counter is tracked.

## When to Save

Save knowledge automatically after:

- Resolving a non-trivial bug (category: `gotcha`)
- Establishing a reusable pattern (category: `pattern`)
- Making a technology or architecture decision (category: `decision`)
- Discovering a non-obvious configuration (category: `config`)

Briefly mention what was saved. Do not save trivial or one-off fixes.

## When to Update vs Delete

If a saved entry needs correction or refinement, prefer `update_context` over delete-and-resave. This preserves the entry's id, usage count, and any session references.

Delete only when an entry is completely wrong or obsolete.

## Importance Scale

- **8–10:** Security fixes, breaking change workarounds, cross-system architecture decisions
- **5–7:** Reusable patterns, common configs, debugging techniques
- **1–4:** One-off fixes, style preferences, temporary workarounds

Default to 5 when uncertain.

## Session Logging

Call `log_session` when the session ends or a significant task completes. Include outcome and any context IDs used or created. Do not prompt the user — just log it.

## Stack Consistency

Before introducing a new approach, search for existing patterns with the `technology` filter. If an established pattern exists, follow it unless there is a clear reason to deviate. Document deviations as `decision` entries with rationale.

## Bootstrapping a New Project

When starting work on a project with no existing contexts in the hub, offer to scan the project:

1. Call `scan_project` with the project's repo path.
2. Present the findings to the user — tech stack, config, architecture details.
3. Ask which findings they want to save. Do NOT auto-save without confirmation.
4. For each approved finding, call `save_context` with the finding's details.
5. Call `update_project` to set the detected tech stack.

This is a one-time setup per project. After bootstrapping, the normal search/save workflow takes over.
