// Property 4: Search category filter
// Property 5: Search project filter
// Property 6: Result limit enforcement
// Property 7: Usage counter increment (now via getContextById, not search)
// Property 12: Technology filter returns only matching projects
// Property 13: Technology filter ordering

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  initDb,
  saveContext,
  searchContexts,
  getContextById,
  updateProject,
} from "../src/db.js";
import type { SaveContextInput } from "../src/types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = [
  "pattern", "decision", "gotcha", "snippet",
  "architecture", "prompt", "debug", "config", "general",
] as const;

const safeWordArb = fc.stringMatching(/^[a-zA-Z]{3,20}$/);

const safeTextArb = fc
  .array(safeWordArb, { minLength: 1, maxLength: 4 })
  .map((words) => words.join(" "));

const contextEntryArb = fc.record({
  project_name: fc.stringMatching(/^[a-zA-Z]{3,20}$/),
  title: safeTextArb,
  content: safeTextArb,
  category: fc.constantFrom(...VALID_CATEGORIES),
  tags: fc.option(
    fc.array(safeWordArb, { minLength: 1, maxLength: 3 }).map((a) => a.join(",")),
    { nil: undefined },
  ),
  language: fc.option(
    fc.constantFrom("typescript", "python", "rust", "go", "java"),
    { nil: undefined },
  ),
  file_path: fc.option(fc.constant("src/example.ts"), { nil: undefined }),
  importance: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Property 4: Search category filter
// ---------------------------------------------------------------------------

describe("Property 4 – Search category filter", () => {
  it("results only contain entries matching the filter category", () => {
    fc.assert(
      fc.property(
        fc.array(contextEntryArb, { minLength: 3, maxLength: 8 }),
        fc.constantFrom(...VALID_CATEGORIES),
        safeWordArb,
        (entries, filterCategory, sharedWord) => {
          const db = initDb(":memory:");
          try {
            for (const entry of entries) {
              const parsed: SaveContextInput = {
                project_name: entry.project_name,
                title: `${sharedWord} ${entry.title}`,
                content: entry.content,
                category: entry.category,
                tags: entry.tags,
                language: entry.language,
                file_path: entry.file_path,
                importance: entry.importance ?? 5,
              };
              saveContext(db, parsed);
            }

            const results = searchContexts(db, {
              query: sharedWord,
              category: filterCategory,
              limit: 100,
            });

            for (const row of results) {
              expect(row.category).toBe(filterCategory);
            }
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Search project filter
// ---------------------------------------------------------------------------

describe("Property 5 – Search project filter", () => {
  it("results only contain entries from the specified project", () => {
    fc.assert(
      fc.property(
        fc.array(contextEntryArb, { minLength: 3, maxLength: 8 }),
        safeWordArb,
        (entries, sharedWord) => {
          const db = initDb(":memory:");
          try {
            for (const entry of entries) {
              const parsed: SaveContextInput = {
                project_name: entry.project_name,
                title: `${sharedWord} ${entry.title}`,
                content: entry.content,
                category: entry.category,
                tags: entry.tags,
                language: entry.language,
                file_path: entry.file_path,
                importance: entry.importance ?? 5,
              };
              saveContext(db, parsed);
            }

            const filterProject = entries[0].project_name;

            const results = searchContexts(db, {
              query: sharedWord,
              project_name: filterProject,
              limit: 100,
            });

            for (const row of results) {
              expect(row.project_name).toBe(filterProject);
            }
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Result limit enforcement
// ---------------------------------------------------------------------------

describe("Property 6 – Result limit enforcement", () => {
  it("result count ≤ specified limit for FTS search and technology search", () => {
    fc.assert(
      fc.property(
        fc.array(contextEntryArb, { minLength: 5, maxLength: 15 }),
        fc.integer({ min: 1, max: 10 }),
        safeWordArb,
        safeWordArb,
        (entries, limit, sharedWord, techStack) => {
          const db = initDb(":memory:");
          try {
            for (const entry of entries) {
              const parsed: SaveContextInput = {
                project_name: entry.project_name,
                title: `${sharedWord} ${entry.title}`,
                content: entry.content,
                category: entry.category,
                tags: entry.tags,
                language: entry.language,
                file_path: entry.file_path,
                importance: entry.importance ?? 5,
              };
              saveContext(db, parsed);
            }

            // Set tech_stack on all projects
            const projects = db
              .prepare("SELECT name FROM projects")
              .all() as { name: string }[];
            for (const p of projects) {
              updateProject(db, p.name, { tech_stack: techStack });
            }

            // Test FTS search limit
            const searchResults = searchContexts(db, {
              query: sharedWord,
              limit,
            });
            expect(searchResults.length).toBeLessThanOrEqual(limit);

            // Test technology filter limit
            const techResults = searchContexts(db, {
              technology: techStack,
              limit,
            });
            expect(techResults.length).toBeLessThanOrEqual(limit);
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: getContextById increments usage counter
// ---------------------------------------------------------------------------

describe("Property 7 – getContextById increments usage counter", () => {
  it("each getContextById call increments times_used by 1; search does NOT increment", () => {
    fc.assert(
      fc.property(
        fc.array(contextEntryArb, { minLength: 1, maxLength: 5 }),
        safeWordArb,
        (entries, sharedWord) => {
          const db = initDb(":memory:");
          try {
            const ids: number[] = [];
            for (const entry of entries) {
              const parsed: SaveContextInput = {
                project_name: entry.project_name,
                title: `${sharedWord} ${entry.title}`,
                content: entry.content,
                category: entry.category,
                tags: entry.tags,
                language: entry.language,
                file_path: entry.file_path,
                importance: entry.importance ?? 5,
              };
              ids.push(saveContext(db, parsed));
            }

            // Search should NOT increment times_used
            searchContexts(db, { query: sharedWord, limit: 100 });

            for (const id of ids) {
              const row = db
                .prepare("SELECT times_used FROM contexts WHERE id = ?")
                .get(id) as { times_used: number };
              expect(row.times_used).toBe(0);
            }

            // getContextById SHOULD increment
            const targetId = ids[0];
            const entry = getContextById(db, targetId);
            expect(entry).not.toBeNull();
            expect(entry!.times_used).toBe(1);

            // Verify in the database
            const afterRow = db
              .prepare("SELECT times_used FROM contexts WHERE id = ?")
              .get(targetId) as { times_used: number };
            expect(afterRow.times_used).toBe(1);
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12: Technology filter returns only matching projects
// ---------------------------------------------------------------------------

describe("Property 12 – Technology filter returns only matching projects", () => {
  it("results come only from projects whose tech_stack contains the search string", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z]{3,10}$/),
        fc.stringMatching(/^[a-zA-Z]{3,10}$/),
        fc.stringMatching(/^[a-zA-Z]{3,10}$/),
        fc.stringMatching(/^[a-zA-Z]{3,10}$/),
        safeTextArb,
        (projA, projB, techMatch, techOther, content) => {
          const projectA = `alpha${projA}`;
          const projectB = `beta${projB}`;
          const matchTech = `match${techMatch}`;
          const otherTech = `other${techOther}`;

          const db = initDb(":memory:");
          try {
            saveContext(db, {
              project_name: projectA,
              title: content,
              content: content,
              category: "pattern",
              importance: 5,
            });
            saveContext(db, {
              project_name: projectB,
              title: content,
              content: content,
              category: "pattern",
              importance: 5,
            });

            updateProject(db, projectA, { tech_stack: matchTech });
            updateProject(db, projectB, { tech_stack: otherTech });

            // Use the merged search with technology filter
            const results = searchContexts(db, {
              technology: matchTech,
              limit: 100,
            });

            for (const row of results) {
              expect(row.project_name).not.toBe(projectB);
            }
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13: Technology filter ordering
// ---------------------------------------------------------------------------

describe("Property 13 – Technology filter ordering", () => {
  it("technology-only results ordered by importance desc, then times_used desc", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            importance: fc.integer({ min: 1, max: 10 }),
            timesUsed: fc.integer({ min: 0, max: 50 }),
          }),
          { minLength: 3, maxLength: 10 },
        ),
        fc.stringMatching(/^[a-zA-Z]{3,10}$/),
        safeTextArb,
        (entrySpecs, techWord, content) => {
          const techStack = `stack${techWord}`;
          const db = initDb(":memory:");
          try {
            const projectName = "orderproject";

            const ids: number[] = [];
            for (const spec of entrySpecs) {
              const id = saveContext(db, {
                project_name: projectName,
                title: content,
                content: content,
                category: "pattern",
                importance: spec.importance,
              });
              ids.push(id);

              if (spec.timesUsed > 0) {
                db.prepare(
                  "UPDATE contexts SET times_used = ? WHERE id = ?",
                ).run(spec.timesUsed, id);
              }
            }

            updateProject(db, projectName, { tech_stack: techStack });

            // Use merged search with technology filter (no FTS query)
            const results = searchContexts(db, {
              technology: techStack,
              limit: 100,
            });

            for (let i = 1; i < results.length; i++) {
              const prev = results[i - 1];
              const curr = results[i];

              if (prev.importance === curr.importance) {
                expect(prev.times_used).toBeGreaterThanOrEqual(curr.times_used);
              } else {
                expect(prev.importance).toBeGreaterThan(curr.importance);
              }
            }
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
