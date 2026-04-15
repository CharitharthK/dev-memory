// Property 18: Zod validation rejects invalid input

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  CategoryEnum,
  SearchContextSchema,
  GetContextSchema,
  SaveContextSchema,
  UpdateContextSchema,
  DeleteContextSchema,
  UpdateProjectSchema,
  LogSessionSchema,
  ScanProjectSchema,
} from "../src/types.js";

const VALID_CATEGORIES = [
  "pattern", "decision", "gotcha", "snippet",
  "architecture", "prompt", "debug", "config", "general",
] as const;

const invalidCategoryArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !(VALID_CATEGORIES as readonly string[]).includes(s));

// ---------------------------------------------------------------------------
// 1. Missing required fields
// ---------------------------------------------------------------------------

describe("Property 18 – Missing required fields are rejected", () => {
  it("SaveContextSchema rejects objects missing any required field", () => {
    const requiredKeys = ["project_name", "title", "content", "category"] as const;

    fc.assert(
      fc.property(
        fc.constantFrom(...requiredKeys),
        fc.record({
          project_name: fc.string({ minLength: 1, maxLength: 50 }),
          title: fc.string({ minLength: 1, maxLength: 100 }),
          content: fc.string({ minLength: 1, maxLength: 200 }),
          category: fc.constantFrom(...VALID_CATEGORIES),
        }),
        (keyToRemove, fullObj) => {
          const partial: Record<string, unknown> = { ...fullObj };
          delete partial[keyToRemove];
          const result = SaveContextSchema.safeParse(partial);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("GetContextSchema rejects objects missing 'id'", () => {
    fc.assert(
      fc.property(fc.record({ extra: fc.string() }), (obj) => {
        const result = GetContextSchema.safeParse(obj);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("UpdateContextSchema rejects objects missing 'id'", () => {
    fc.assert(
      fc.property(
        fc.record({ title: fc.string({ minLength: 1 }) }),
        (obj) => {
          const result = UpdateContextSchema.safeParse(obj);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("DeleteContextSchema rejects objects missing 'id'", () => {
    fc.assert(
      fc.property(fc.record({ extra: fc.string() }), (obj) => {
        const result = DeleteContextSchema.safeParse(obj);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("UpdateProjectSchema rejects objects missing 'name'", () => {
    fc.assert(
      fc.property(
        fc.record({
          tech_stack: fc.string(),
          description: fc.string(),
        }),
        (obj) => {
          const result = UpdateProjectSchema.safeParse(obj);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("LogSessionSchema rejects objects missing required fields", () => {
    const requiredKeys = ["project_name", "summary"] as const;

    fc.assert(
      fc.property(
        fc.constantFrom(...requiredKeys),
        fc.record({
          project_name: fc.string({ minLength: 1, maxLength: 50 }),
          summary: fc.string({ minLength: 1, maxLength: 200 }),
        }),
        (keyToRemove, fullObj) => {
          const partial: Record<string, unknown> = { ...fullObj };
          delete partial[keyToRemove];
          const result = LogSessionSchema.safeParse(partial);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Wrong types
// ---------------------------------------------------------------------------

describe("Property 18 – Wrong types are rejected", () => {
  it("SearchContextSchema rejects non-string query", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.array(fc.integer()),
        ),
        (badQuery) => {
          const result = SearchContextSchema.safeParse({ query: badQuery });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("GetContextSchema rejects non-integer id", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.boolean(),
          fc.constant(null),
          fc.double({ noInteger: true }),
          fc.integer({ max: 0 }),
        ),
        (badId) => {
          const result = GetContextSchema.safeParse({ id: badId });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("SaveContextSchema rejects non-number importance", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ minLength: 1 }), fc.boolean(), fc.array(fc.integer())),
        (badImportance) => {
          const result = SaveContextSchema.safeParse({
            project_name: "proj",
            title: "t",
            content: "c",
            category: "pattern",
            importance: badImportance,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("UpdateContextSchema rejects out-of-range importance", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 11 })),
        (badImportance) => {
          const result = UpdateContextSchema.safeParse({
            id: 1,
            importance: badImportance,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("DeleteContextSchema rejects non-integer id", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.boolean(),
          fc.constant(null),
          fc.double({ noInteger: true }),
          fc.integer({ max: 0 }),
        ),
        (badId) => {
          const result = DeleteContextSchema.safeParse({ id: badId });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("LogSessionSchema rejects non-string summary", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)),
        (badSummary) => {
          const result = LogSessionSchema.safeParse({
            project_name: "proj",
            summary: badSummary,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Invalid category values
// ---------------------------------------------------------------------------

describe("Property 18 – Invalid category values are rejected", () => {
  it("CategoryEnum rejects strings not in the enum", () => {
    fc.assert(
      fc.property(invalidCategoryArb, (badCategory) => {
        const result = CategoryEnum.safeParse(badCategory);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("SaveContextSchema rejects invalid category", () => {
    fc.assert(
      fc.property(invalidCategoryArb, (badCategory) => {
        const result = SaveContextSchema.safeParse({
          project_name: "proj",
          title: "title",
          content: "content",
          category: badCategory,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("UpdateContextSchema rejects invalid category", () => {
    fc.assert(
      fc.property(invalidCategoryArb, (badCategory) => {
        const result = UpdateContextSchema.safeParse({
          id: 1,
          category: badCategory,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("SearchContextSchema rejects invalid category filter", () => {
    fc.assert(
      fc.property(invalidCategoryArb, (badCategory) => {
        const result = SearchContextSchema.safeParse({
          query: "test",
          category: badCategory,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Valid inputs pass validation (positive case)
// ---------------------------------------------------------------------------

describe("Property 18 – Valid inputs pass validation", () => {
  it("SearchContextSchema accepts valid input with query", () => {
    fc.assert(
      fc.property(
        fc.record({
          query: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
          category: fc.option(fc.constantFrom(...VALID_CATEGORIES), { nil: undefined }),
          project_name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
          technology: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
          limit: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
        }),
        (input) => {
          const result = SearchContextSchema.safeParse(input);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("SearchContextSchema accepts valid input with only technology", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        (technology) => {
          const result = SearchContextSchema.safeParse({ technology });
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("GetContextSchema accepts valid input", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (id) => {
        const result = GetContextSchema.safeParse({ id });
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("SaveContextSchema accepts valid input", () => {
    fc.assert(
      fc.property(
        fc.record({
          project_name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          title: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
          content: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
          category: fc.constantFrom(...VALID_CATEGORIES),
          tags: fc.option(fc.string(), { nil: undefined }),
          language: fc.option(fc.string(), { nil: undefined }),
          file_path: fc.option(fc.string(), { nil: undefined }),
          importance: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
        }),
        (input) => {
          const result = SaveContextSchema.safeParse(input);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("UpdateContextSchema accepts valid input", () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.integer({ min: 1, max: 1_000_000 }),
          title: fc.option(
            fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
            { nil: undefined },
          ),
          content: fc.option(
            fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
            { nil: undefined },
          ),
          category: fc.option(fc.constantFrom(...VALID_CATEGORIES), { nil: undefined }),
          importance: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
        }),
        (input) => {
          const result = UpdateContextSchema.safeParse(input);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("DeleteContextSchema accepts valid input", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (id) => {
        const result = DeleteContextSchema.safeParse({ id });
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("UpdateProjectSchema accepts valid input", () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          tech_stack: fc.option(fc.string(), { nil: undefined }),
          description: fc.option(fc.string(), { nil: undefined }),
          repo_path: fc.option(fc.string(), { nil: undefined }),
        }),
        (input) => {
          const result = UpdateProjectSchema.safeParse(input);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("LogSessionSchema accepts valid input", () => {
    fc.assert(
      fc.property(
        fc.record({
          project_name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          summary: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
          outcome: fc.option(fc.string(), { nil: undefined }),
          context_ids_used: fc.option(
            fc.array(fc.integer({ min: 1, max: 10000 }), { maxLength: 10 }),
            { nil: undefined },
          ),
        }),
        (input) => {
          const result = LogSessionSchema.safeParse(input);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("ScanProjectSchema accepts valid input", () => {
    fc.assert(
      fc.property(
        fc.record({
          repo_path: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
          project_name: fc.option(
            fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
            { nil: undefined },
          ),
        }),
        (input) => {
          const result = ScanProjectSchema.safeParse(input);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("ScanProjectSchema rejects empty repo_path", () => {
    const result = ScanProjectSchema.safeParse({ repo_path: "" });
    expect(result.success).toBe(false);
  });

  it("ScanProjectSchema rejects missing repo_path", () => {
    const result = ScanProjectSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
