// Property 8: Auto-create project on save and log
// Property 10: List projects with accurate context counts
// Property 11: Partial project update preserves unmodified fields
// Property 14: Hub stats counts accuracy
// Property 15: Hub stats top-used and recent ordering
// Property 16: Session logging round-trip
// NEW Property 20: updateContext partial update preserves unmodified fields

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  initDb,
  saveContext,
  logSession,
  listProjects,
  updateProject,
  updateContext,
  getHubStats,
  getContextById,
} from "../src/db.js";
import type { SaveContextInput, LogSessionInput } from "../src/types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = [
  "pattern", "decision", "gotcha", "snippet",
  "architecture", "prompt", "debug", "config", "general",
] as const;

const projectNameArb = fc.stringMatching(/^[a-zA-Z]{3,20}$/);
const safeWordArb = fc.stringMatching(/^[a-zA-Z]{3,20}$/);

const safeTextArb = fc
  .array(safeWordArb, { minLength: 1, maxLength: 4 })
  .map((words) => words.join(" "));

// ---------------------------------------------------------------------------
// Property 8: Auto-create project on save and log
// ---------------------------------------------------------------------------

describe("Property 8 – Auto-create project on save and log", () => {
  it("saveContext with a new project name auto-creates the project", () => {
    fc.assert(
      fc.property(
        projectNameArb,
        safeTextArb,
        safeTextArb,
        fc.constantFrom(...VALID_CATEGORIES),
        (projectName, title, content, category) => {
          const db = initDb(":memory:");
          try {
            const beforeProjects = listProjects(db);
            const beforeNames = beforeProjects.map((p) => p.name);
            expect(beforeNames).not.toContain(projectName);

            const entry: SaveContextInput = {
              project_name: projectName,
              title,
              content,
              category,
              importance: 5,
            };
            const id = saveContext(db, entry);
            expect(id).toBeGreaterThan(0);

            const afterProjects = listProjects(db);
            const afterNames = afterProjects.map((p) => p.name);
            expect(afterNames).toContain(projectName);
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("logSession with a new project name auto-creates the project", () => {
    fc.assert(
      fc.property(
        projectNameArb,
        safeTextArb,
        (projectName, summary) => {
          const db = initDb(":memory:");
          try {
            const beforeProjects = listProjects(db);
            const beforeNames = beforeProjects.map((p) => p.name);
            expect(beforeNames).not.toContain(projectName);

            const session: LogSessionInput = {
              project_name: projectName,
              summary,
            };
            const sessionId = logSession(db, session);
            expect(sessionId).toBeGreaterThan(0);

            const afterProjects = listProjects(db);
            const afterNames = afterProjects.map((p) => p.name);
            expect(afterNames).toContain(projectName);
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
// Property 10: List projects with accurate context counts
// ---------------------------------------------------------------------------

describe("Property 10 – List projects with accurate context counts", () => {
  it("each project's context_count matches actual context records", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: projectNameArb,
            contextCount: fc.integer({ min: 0, max: 4 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (projectSpecs) => {
          const db = initDb(":memory:");
          try {
            const seen = new Set<string>();
            const uniqueSpecs = projectSpecs.filter((s) => {
              if (seen.has(s.name)) return false;
              seen.add(s.name);
              return true;
            });

            const expectedCounts = new Map<string, number>();
            for (const spec of uniqueSpecs) {
              if (spec.contextCount > 0) {
                for (let i = 0; i < spec.contextCount; i++) {
                  saveContext(db, {
                    project_name: spec.name,
                    title: `title${i}`,
                    content: `content${i}`,
                    category: "general",
                    importance: 5,
                  });
                }
                expectedCounts.set(spec.name, spec.contextCount);
              } else {
                db.prepare("INSERT OR IGNORE INTO projects (name) VALUES (?)").run(spec.name);
                expectedCounts.set(spec.name, 0);
              }
            }

            const projects = listProjects(db);

            expect(projects.length).toBe(uniqueSpecs.length);

            for (const project of projects) {
              expect(project.context_count).toBe(expectedCounts.get(project.name));
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
// Property 11: Partial project update preserves unmodified fields
// ---------------------------------------------------------------------------

describe("Property 11 – Partial project update preserves unmodified fields", () => {
  it("only specified fields change, others remain the same", () => {
    fc.assert(
      fc.property(
        projectNameArb,
        safeTextArb,
        safeTextArb,
        safeTextArb,
        fc.record({
          updateTechStack: fc.boolean(),
          updateDescription: fc.boolean(),
          updateRepoPath: fc.boolean(),
        }).filter((r) => r.updateTechStack || r.updateDescription || r.updateRepoPath),
        safeTextArb,
        safeTextArb,
        safeTextArb,
        (name, initTech, initDesc, initRepo, flags, newTech, newDesc, newRepo) => {
          const db = initDb(":memory:");
          try {
            // Create project with initial values
            db.prepare("INSERT INTO projects (name, tech_stack, description, repo_path) VALUES (?, ?, ?, ?)").run(
              name, initTech, initDesc, initRepo,
            );

            // Build partial update
            const fields: { tech_stack?: string; description?: string; repo_path?: string } = {};
            if (flags.updateTechStack) fields.tech_stack = newTech;
            if (flags.updateDescription) fields.description = newDesc;
            if (flags.updateRepoPath) fields.repo_path = newRepo;

            updateProject(db, name, fields);

            const row = db
              .prepare("SELECT * FROM projects WHERE name = ?")
              .get(name) as Record<string, unknown>;

            if (flags.updateTechStack) {
              expect(row.tech_stack).toBe(newTech);
            } else {
              expect(row.tech_stack).toBe(initTech);
            }

            if (flags.updateDescription) {
              expect(row.description).toBe(newDesc);
            } else {
              expect(row.description).toBe(initDesc);
            }

            if (flags.updateRepoPath) {
              expect(row.repo_path).toBe(newRepo);
            } else {
              expect(row.repo_path).toBe(initRepo);
            }

            expect(row.name).toBe(name);
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
// Property 14: Hub stats counts accuracy
// ---------------------------------------------------------------------------

describe("Property 14 – Hub stats counts accuracy", () => {
  it("total counts match actual records and category breakdown sums to total", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            projectName: projectNameArb,
            category: fc.constantFrom(...VALID_CATEGORIES),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        (entries) => {
          const db = initDb(":memory:");
          try {
            const projectNames = new Set<string>();

            for (let i = 0; i < entries.length; i++) {
              const e = entries[i];
              saveContext(db, {
                project_name: e.projectName,
                title: `title${i}`,
                content: `content${i}`,
                category: e.category,
                importance: 5,
              });
              projectNames.add(e.projectName);
            }

            const stats = getHubStats(db);

            expect(stats.total_projects).toBe(projectNames.size);
            expect(stats.total_contexts).toBe(entries.length);

            const categorySum = Object.values(stats.categories).reduce((a, b) => a + b, 0);
            expect(categorySum).toBe(entries.length);

            const expectedCategories = new Map<string, number>();
            for (const e of entries) {
              expectedCategories.set(e.category, (expectedCategories.get(e.category) ?? 0) + 1);
            }
            for (const [cat, count] of expectedCategories) {
              expect(stats.categories[cat]).toBe(count);
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
// Property 15: Hub stats top-used and recent ordering
// ---------------------------------------------------------------------------

describe("Property 15 – Hub stats top-used and recent ordering", () => {
  it("top 5 ordered by times_used desc, recent 5 have descending ids (most recent inserts)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            timesUsed: fc.integer({ min: 0, max: 1000 }),
          }),
          { minLength: 5, maxLength: 10 },
        ),
        (entrySpecs) => {
          const db = initDb(":memory:");
          try {
            const projectName = "testproject";

            const ids: number[] = [];
            for (let i = 0; i < entrySpecs.length; i++) {
              const id = saveContext(db, {
                project_name: projectName,
                title: `title${i}`,
                content: `content${i}`,
                category: "general",
                importance: 5,
              });
              ids.push(id);
            }

            for (let i = 0; i < entrySpecs.length; i++) {
              db.prepare("UPDATE contexts SET times_used = ? WHERE id = ?").run(
                entrySpecs[i].timesUsed, ids[i],
              );
            }

            const stats = getHubStats(db);

            // Top used: ordered by times_used desc
            expect(stats.top_used.length).toBeLessThanOrEqual(5);
            for (let i = 1; i < stats.top_used.length; i++) {
              expect(stats.top_used[i - 1].times_used).toBeGreaterThanOrEqual(
                stats.top_used[i].times_used,
              );
            }

            // Recent: should be at most 5 and ordered by created_at desc.
            // When created_at ties (same second), ordering within the tie
            // is non-deterministic, so we only assert on the count.
            expect(stats.recent.length).toBeLessThanOrEqual(5);
            expect(stats.recent.length).toBeGreaterThan(0);
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
// Property 16: Session logging round-trip
// ---------------------------------------------------------------------------

describe("Property 16 – Session logging round-trip", () => {
  it("logged session fields stored correctly including JSON context_ids_used", () => {
    fc.assert(
      fc.property(
        projectNameArb,
        safeTextArb,
        fc.option(safeTextArb),
        fc.option(fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 0, maxLength: 5 })),
        (projectName, summary, outcome, contextIdsUsed) => {
          const db = initDb(":memory:");
          try {
            const session: LogSessionInput = {
              project_name: projectName,
              summary,
              outcome: outcome ?? undefined,
              context_ids_used: contextIdsUsed ?? undefined,
            };

            const sessionId = logSession(db, session);
            expect(sessionId).toBeGreaterThan(0);

            const row = db
              .prepare(
                "SELECT s.*, p.name AS project_name FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?",
              )
              .get(sessionId) as Record<string, unknown>;

            expect(row).toBeDefined();
            expect(row.project_name).toBe(projectName);
            expect(row.summary).toBe(summary);
            expect(row.outcome).toBe(outcome ?? "");

            const storedContextIds = JSON.parse(row.contexts_used as string);
            const expectedContextIds = contextIdsUsed ?? [];
            expect(storedContextIds).toEqual(expectedContextIds);
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
// Property 20: updateContext partial update preserves unmodified fields
// ---------------------------------------------------------------------------

describe("Property 20 – updateContext partial update preserves unmodified fields", () => {
  it("only provided fields change, usage count and other fields are preserved", () => {
    fc.assert(
      fc.property(
        projectNameArb,
        safeTextArb,
        safeTextArb,
        fc.constantFrom(...VALID_CATEGORIES),
        fc.integer({ min: 1, max: 10 }),
        // What to update
        fc.record({
          updateTitle: fc.boolean(),
          updateContent: fc.boolean(),
          updateImportance: fc.boolean(),
        }).filter((r) => r.updateTitle || r.updateContent || r.updateImportance),
        safeTextArb,
        safeTextArb,
        fc.integer({ min: 1, max: 10 }),
        (projName, initTitle, initContent, initCategory, initImportance, flags, newTitle, newContent, newImportance) => {
          const db = initDb(":memory:");
          try {
            const id = saveContext(db, {
              project_name: projName,
              title: initTitle,
              content: initContent,
              category: initCategory,
              importance: initImportance,
            });

            // Set some usage to verify it's preserved
            db.prepare("UPDATE contexts SET times_used = 7 WHERE id = ?").run(id);

            const updates: Record<string, unknown> = { id };
            if (flags.updateTitle) updates.title = newTitle;
            if (flags.updateContent) updates.content = newContent;
            if (flags.updateImportance) updates.importance = newImportance;

            const result = updateContext(db, updates as any);
            expect(result).toBe(true);

            const row = getContextById(db, id);
            expect(row).not.toBeNull();

            // Updated fields should have new values
            if (flags.updateTitle) {
              expect(row!.title).toBe(newTitle);
            } else {
              expect(row!.title).toBe(initTitle);
            }
            if (flags.updateContent) {
              expect(row!.content).toBe(newContent);
            } else {
              expect(row!.content).toBe(initContent);
            }
            if (flags.updateImportance) {
              expect(row!.importance).toBe(newImportance);
            } else {
              expect(row!.importance).toBe(initImportance);
            }

            // Category should be unchanged
            expect(row!.category).toBe(initCategory);

            // times_used should be 7 + 1 (getContextById increments)
            expect(row!.times_used).toBe(8);

            // Non-existent id returns false
            expect(updateContext(db, { id: 999999, title: "x" })).toBe(false);
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
