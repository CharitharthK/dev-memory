// Property 1: Save-then-search round-trip
// Property 2: Save-then-delete FTS cleanup
// Property 3: FTS update synchronization (now via updateContext)
// Property 9: Default importance
// NEW Property 19: getContextById round-trip and usage increment

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  initDb,
  saveContext,
  deleteContext,
  searchContexts,
  getContextById,
  updateContext,
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
// Property 1: Save-then-search round-trip
// ---------------------------------------------------------------------------

describe("Property 1 – Save-then-search round-trip", () => {
  it("saving a context entry and searching by its title returns the entry as a summary", () => {
    fc.assert(
      fc.property(contextEntryArb, (entry) => {
        const db = initDb(":memory:");
        try {
          const parsed: SaveContextInput = {
            project_name: entry.project_name,
            title: entry.title,
            content: entry.content,
            category: entry.category,
            tags: entry.tags,
            language: entry.language,
            file_path: entry.file_path,
            importance: entry.importance ?? 5,
          };

          const id = saveContext(db, parsed);
          expect(id).toBeGreaterThan(0);

          const firstWord = entry.title.split(" ")[0];
          const results = searchContexts(db, { query: firstWord });

          expect(results.length).toBeGreaterThanOrEqual(1);

          const found = results.find((r) => r.id === id);
          expect(found).toBeDefined();

          // Summary fields match
          expect(found!.title).toBe(entry.title);
          expect(found!.category).toBe(entry.category);
          expect(found!.tags).toBe(entry.tags ?? "");
          expect(found!.importance).toBe(entry.importance ?? 5);
          expect(found!.project_name).toBe(entry.project_name);
          // Preview is a truncation of the full content
          expect(entry.content.startsWith(found!.preview.replace("…", ""))).toBe(true);
        } finally {
          db.close();
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Save-then-delete FTS cleanup
// ---------------------------------------------------------------------------

describe("Property 2 – Save-then-delete FTS cleanup", () => {
  it("saving then deleting a context entry results in zero FTS search results for that entry", () => {
    fc.assert(
      fc.property(contextEntryArb, (entry) => {
        const db = initDb(":memory:");
        try {
          const parsed: SaveContextInput = {
            project_name: entry.project_name,
            title: entry.title,
            content: entry.content,
            category: entry.category,
            tags: entry.tags,
            language: entry.language,
            file_path: entry.file_path,
            importance: entry.importance ?? 5,
          };

          const id = saveContext(db, parsed);
          const deleted = deleteContext(db, id);
          expect(deleted).toBe(true);

          const firstWord = entry.title.split(" ")[0];
          const results = searchContexts(db, { query: firstWord });

          const found = results.find((r) => r.id === id);
          expect(found).toBeUndefined();
        } finally {
          db.close();
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: FTS update synchronization (via updateContext)
// ---------------------------------------------------------------------------

describe("Property 3 – FTS update synchronization", () => {
  it("updating title/content via updateContext causes FTS to match new content and not old content", () => {
    fc.assert(
      fc.property(
        contextEntryArb,
        safeWordArb,
        safeWordArb,
        (entry, newTitleWord, newContentWord) => {
          const db = initDb(":memory:");
          try {
            const parsed: SaveContextInput = {
              project_name: entry.project_name,
              title: entry.title,
              content: entry.content,
              category: entry.category,
              tags: entry.tags,
              language: entry.language,
              file_path: entry.file_path,
              importance: entry.importance ?? 5,
            };

            const id = saveContext(db, parsed);

            const newTitle = `updated ${newTitleWord}`;
            const newContent = `refreshed ${newContentWord}`;

            // Use the new updateContext function
            const updated = updateContext(db, {
              id,
              title: newTitle,
              content: newContent,
            });
            expect(updated).toBe(true);

            // Search for the new title word — should find the entry
            const newResults = searchContexts(db, { query: newTitleWord });
            const foundNew = newResults.find((r) => r.id === id);
            expect(foundNew).toBeDefined();
            expect(foundNew!.title).toBe(newTitle);

            // Search for the old title's first word — should NOT find the entry
            const oldWord = entry.title.split(" ")[0];
            const oldInNew =
              newTitle.toLowerCase().includes(oldWord.toLowerCase()) ||
              newContent.toLowerCase().includes(oldWord.toLowerCase());

            if (!oldInNew) {
              const oldResults = searchContexts(db, { query: oldWord });
              const foundOld = oldResults.find((r) => r.id === id);
              expect(foundOld).toBeUndefined();
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
// Property 9: Default importance
// ---------------------------------------------------------------------------

describe("Property 9 – Default importance", () => {
  it("saving without importance stores a default value of 5", () => {
    fc.assert(
      fc.property(
        fc.record({
          project_name: fc.stringMatching(/^[a-zA-Z]{3,20}$/),
          title: safeTextArb,
          content: safeTextArb,
          category: fc.constantFrom(...VALID_CATEGORIES),
        }),
        (entry) => {
          const db = initDb(":memory:");
          try {
            const parsed: SaveContextInput = {
              project_name: entry.project_name,
              title: entry.title,
              content: entry.content,
              category: entry.category,
              importance: 5, // Zod default
            };

            const id = saveContext(db, parsed);

            const row = db
              .prepare("SELECT importance FROM contexts WHERE id = ?")
              .get(id) as { importance: number };

            expect(row.importance).toBe(5);
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
// Property 19: getContextById round-trip and usage increment
// ---------------------------------------------------------------------------

describe("Property 19 – getContextById round-trip and usage increment", () => {
  it("fetching by id returns full content and increments times_used by 1", () => {
    fc.assert(
      fc.property(contextEntryArb, (entry) => {
        const db = initDb(":memory:");
        try {
          const parsed: SaveContextInput = {
            project_name: entry.project_name,
            title: entry.title,
            content: entry.content,
            category: entry.category,
            tags: entry.tags,
            language: entry.language,
            file_path: entry.file_path,
            importance: entry.importance ?? 5,
          };

          const id = saveContext(db, parsed);

          // First fetch — times_used should be 1
          const first = getContextById(db, id);
          expect(first).not.toBeNull();
          expect(first!.id).toBe(id);
          expect(first!.title).toBe(entry.title);
          expect(first!.content).toBe(entry.content);
          expect(first!.category).toBe(entry.category);
          expect(first!.project_name).toBe(entry.project_name);
          expect(first!.times_used).toBe(1);

          // Second fetch — times_used should be 2
          const second = getContextById(db, id);
          expect(second!.times_used).toBe(2);

          // Non-existent id returns null
          expect(getContextById(db, 999999)).toBeNull();
        } finally {
          db.close();
        }
      }),
      { numRuns: 100 },
    );
  });
});
