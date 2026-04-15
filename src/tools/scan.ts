import {
  readdirSync,
  readFileSync,
  statSync,
  existsSync,
} from "node:fs";
import { join, basename, extname } from "node:path";
import { ScanProjectSchema } from "../types.js";
import type { ToolResult, ScanFinding, ScanResult } from "../types.js";

/** Max bytes to read from any single file. */
const MAX_FILE_BYTES = 8_192;

/** Config files worth reading, mapped to what they reveal. */
const CONFIG_FILES: Record<string, { category: string; label: string }> = {
  "package.json": { category: "config", label: "Node.js project config" },
  "tsconfig.json": { category: "config", label: "TypeScript configuration" },
  "tsconfig.base.json": { category: "config", label: "TypeScript base config" },
  ".eslintrc.json": { category: "config", label: "ESLint configuration" },
  ".eslintrc.js": { category: "config", label: "ESLint configuration" },
  "eslint.config.js": { category: "config", label: "ESLint flat config" },
  ".prettierrc": { category: "config", label: "Prettier configuration" },
  "jest.config.js": { category: "config", label: "Jest test configuration" },
  "jest.config.ts": { category: "config", label: "Jest test configuration" },
  "vitest.config.ts": { category: "config", label: "Vitest test configuration" },
  "webpack.config.js": { category: "config", label: "Webpack build config" },
  "webpack.config.ts": { category: "config", label: "Webpack build config" },
  "vite.config.ts": { category: "config", label: "Vite build config" },
  "next.config.js": { category: "config", label: "Next.js configuration" },
  "next.config.mjs": { category: "config", label: "Next.js configuration" },
  "Dockerfile": { category: "config", label: "Docker container configuration" },
  "docker-compose.yml": { category: "architecture", label: "Docker Compose service topology" },
  "docker-compose.yaml": { category: "architecture", label: "Docker Compose service topology" },
  ".env.example": { category: "config", label: "Environment variables template" },
  ".env.sample": { category: "config", label: "Environment variables template" },
  "requirements.txt": { category: "config", label: "Python dependencies" },
  "pyproject.toml": { category: "config", label: "Python project config" },
  "setup.py": { category: "config", label: "Python package setup" },
  "Cargo.toml": { category: "config", label: "Rust project config" },
  "go.mod": { category: "config", label: "Go module config" },
  "pom.xml": { category: "config", label: "Maven project config" },
  "build.gradle": { category: "config", label: "Gradle build config" },
  "Makefile": { category: "config", label: "Build automation" },
};

/** Directories to skip when scanning. */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".venv", "venv", "target", "vendor", ".idea", ".vscode",
  "coverage", ".cache", ".turbo", ".output",
]);

// ── Directory scanner ────────────────────────────────────────────────

interface DirEntry {
  name: string;
  isDir: boolean;
  children?: DirEntry[];
}

function scanDir(dirPath: string, depth: number, maxDepth: number): DirEntry[] {
  if (depth >= maxDepth) return [];

  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }

  const result: DirEntry[] = [];
  for (const name of entries.sort()) {
    if (name.startsWith(".") && name !== ".env.example" && name !== ".env.sample") continue;
    if (SKIP_DIRS.has(name)) continue;

    const fullPath = join(dirPath, name);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      result.push({
        name: name + "/",
        isDir: true,
        children: scanDir(fullPath, depth + 1, maxDepth),
      });
    } else {
      result.push({ name, isDir: false });
    }
  }

  return result;
}

function formatTree(entries: DirEntry[], prefix = ""): string {
  const lines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    lines.push(prefix + connector + entry.name);
    if (entry.children && entry.children.length > 0) {
      const childPrefix = prefix + (isLast ? "    " : "│   ");
      lines.push(formatTree(entry.children, childPrefix));
    }
  }
  return lines.join("\n");
}

// ── File readers ─────────────────────────────────────────────────────

function safeReadFile(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const stat = statSync(filePath);
    if (stat.size > MAX_FILE_BYTES) {
      const buf = Buffer.alloc(MAX_FILE_BYTES);
      const fd = require("fs").openSync(filePath, "r");
      require("fs").readSync(fd, buf, 0, MAX_FILE_BYTES, 0);
      require("fs").closeSync(fd);
      return buf.toString("utf-8") + "\n… (truncated)";
    }
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function safeParseJson(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ── Tech stack detection ─────────────────────────────────────────────

function detectTechStack(repoPath: string): string[] {
  const stack: string[] = [];

  // Node / package.json
  const pkgContent = safeReadFile(join(repoPath, "package.json"));
  if (pkgContent) {
    const pkg = safeParseJson(pkgContent);
    if (pkg) {
      const allDeps = {
        ...(pkg.dependencies as Record<string, string> || {}),
        ...(pkg.devDependencies as Record<string, string> || {}),
      };

      const depMap: Record<string, string> = {
        react: "react", "next": "next.js", vue: "vue", angular: "angular",
        svelte: "svelte", express: "express", fastify: "fastify", koa: "koa",
        "hono": "hono", typescript: "typescript", tailwindcss: "tailwind",
        prisma: "prisma", drizzle: "drizzle", sequelize: "sequelize",
        mongoose: "mongoose", "better-sqlite3": "sqlite",
        redis: "redis", ioredis: "redis",
        jest: "jest", vitest: "vitest", mocha: "mocha",
        webpack: "webpack", vite: "vite", esbuild: "esbuild",
        "styled-components": "styled-components", "@emotion/react": "emotion",
        "@reduxjs/toolkit": "redux-toolkit", zustand: "zustand", mobx: "mobx",
        graphql: "graphql", "@trpc/server": "trpc",
        stripe: "stripe", zod: "zod",
      };

      for (const [dep, label] of Object.entries(depMap)) {
        if (dep in allDeps) stack.push(label);
      }

      if ("node" in (pkg.engines as Record<string, string> || {})) {
        if (!stack.includes("node.js")) stack.push("node.js");
      }
    }
  }

  // Python
  if (existsSync(join(repoPath, "requirements.txt")) ||
      existsSync(join(repoPath, "pyproject.toml")) ||
      existsSync(join(repoPath, "setup.py"))) {
    stack.push("python");
  }

  // Go
  if (existsSync(join(repoPath, "go.mod"))) stack.push("go");

  // Rust
  if (existsSync(join(repoPath, "Cargo.toml"))) stack.push("rust");

  // Java
  if (existsSync(join(repoPath, "pom.xml")) ||
      existsSync(join(repoPath, "build.gradle"))) {
    stack.push("java");
  }

  // Docker
  if (existsSync(join(repoPath, "Dockerfile"))) stack.push("docker");

  return [...new Set(stack)];
}

// ── Findings extraction ──────────────────────────────────────────────

function extractFindings(repoPath: string, techStack: string[]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const language = techStack.includes("typescript") ? "typescript" :
                   techStack.includes("python") ? "python" :
                   techStack.includes("go") ? "go" :
                   techStack.includes("rust") ? "rust" :
                   techStack.includes("java") ? "java" : "";

  // 1. Tech stack summary
  if (techStack.length > 0) {
    findings.push({
      category: "architecture",
      title: "Project tech stack",
      content: `Detected technologies: ${techStack.join(", ")}.\n\nThis was auto-detected from project config files during initial scan.`,
      tags: techStack.slice(0, 5).join(","),
      language,
      source_file: "package.json",
      importance: 7,
    });
  }

  // 2. Read key config files for meaningful findings
  for (const [filename, meta] of Object.entries(CONFIG_FILES)) {
    const filePath = join(repoPath, filename);
    const content = safeReadFile(filePath);
    if (!content) continue;

    // Special handling for package.json — extract scripts and key metadata
    if (filename === "package.json") {
      const pkg = safeParseJson(content);
      if (pkg) {
        const scripts = pkg.scripts as Record<string, string> | undefined;
        if (scripts && Object.keys(scripts).length > 0) {
          findings.push({
            category: "config",
            title: "npm scripts and build commands",
            content: `Available scripts:\n${Object.entries(scripts).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`,
            tags: "npm,scripts,build",
            language,
            source_file: filename,
            importance: 6,
          });
        }
      }
      continue;
    }

    // Special handling for docker-compose — extract service names
    if (filename.startsWith("docker-compose")) {
      const serviceMatches = content.match(/^\s{2}(\w[\w-]*):\s*$/gm);
      if (serviceMatches) {
        const services = serviceMatches.map(s => s.trim().replace(":", ""));
        findings.push({
          category: "architecture",
          title: "Docker Compose service topology",
          content: `Services defined in ${filename}:\n${services.map(s => `  - ${s}`).join("\n")}\n\nFull config:\n${content}`,
          tags: "docker,services,infrastructure",
          language: "",
          source_file: filename,
          importance: 7,
        });
      }
      continue;
    }

    // Special handling for .env.example — document env vars
    if (filename.startsWith(".env")) {
      const vars = content.split("\n")
        .filter(line => line.trim() && !line.startsWith("#"))
        .map(line => line.split("=")[0]?.trim())
        .filter(Boolean);

      if (vars.length > 0) {
        findings.push({
          category: "config",
          title: "Required environment variables",
          content: `Environment variables from ${filename}:\n${vars.map(v => `  - ${v}`).join("\n")}\n\nFull template:\n${content}`,
          tags: "env,configuration,setup",
          language: "",
          source_file: filename,
          importance: 6,
        });
      }
      continue;
    }

    // Special handling for Dockerfile — extract base image and stages
    if (filename === "Dockerfile") {
      const fromLines = content.match(/^FROM\s+.+$/gm) || [];
      findings.push({
        category: "config",
        title: "Dockerfile configuration",
        content: `Base image(s): ${fromLines.map(l => l.replace("FROM ", "").trim()).join(", ")}\n\nFull Dockerfile:\n${content}`,
        tags: "docker,container,deployment",
        language: "",
        source_file: filename,
        importance: 6,
      });
      continue;
    }

    // Generic config file — store as-is with description
    findings.push({
      category: meta.category as string,
      title: meta.label,
      content: `Contents of ${filename}:\n\n${content}`,
      tags: filename.replace(/\./g, "").replace(/\//g, ","),
      language,
      source_file: filename,
      importance: 5,
    });
  }

  // 3. README — extract project description if available
  for (const readmeName of ["README.md", "readme.md", "README.rst", "README.txt", "README"]) {
    const readmeContent = safeReadFile(join(repoPath, readmeName));
    if (readmeContent) {
      // Extract first meaningful section (up to 2000 chars)
      const trimmed = readmeContent.slice(0, 2000);
      findings.push({
        category: "architecture",
        title: "Project overview from README",
        content: trimmed + (readmeContent.length > 2000 ? "\n\n… (truncated)" : ""),
        tags: "readme,overview,documentation",
        language: "",
        source_file: readmeName,
        importance: 6,
      });
      break;
    }
  }

  // 4. Directory structure as architecture context
  const srcDir = existsSync(join(repoPath, "src")) ? "src" :
                 existsSync(join(repoPath, "app")) ? "app" :
                 existsSync(join(repoPath, "lib")) ? "lib" : null;

  if (srcDir) {
    const tree = scanDir(join(repoPath, srcDir), 0, 3);
    if (tree.length > 0) {
      const treeStr = formatTree(tree);
      findings.push({
        category: "architecture",
        title: `Source directory structure (${srcDir}/)`,
        content: `${srcDir}/\n${treeStr}`,
        tags: "structure,architecture,layout",
        language,
        source_file: srcDir + "/",
        importance: 5,
      });
    }
  }

  // 5. CI/CD config detection
  const ciFiles: Array<{ path: string; label: string }> = [
    { path: ".github/workflows", label: "GitHub Actions" },
    { path: ".gitlab-ci.yml", label: "GitLab CI" },
    { path: "Jenkinsfile", label: "Jenkins" },
    { path: ".circleci/config.yml", label: "CircleCI" },
    { path: "bitbucket-pipelines.yml", label: "Bitbucket Pipelines" },
  ];

  for (const ci of ciFiles) {
    const fullPath = join(repoPath, ci.path);
    if (existsSync(fullPath)) {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        // Read workflow files
        try {
          const files = readdirSync(fullPath).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
          for (const file of files.slice(0, 3)) { // max 3 workflow files
            const content = safeReadFile(join(fullPath, file));
            if (content) {
              findings.push({
                category: "config",
                title: `${ci.label} workflow: ${file}`,
                content: content,
                tags: "ci,cd,pipeline,automation",
                language: "",
                source_file: `${ci.path}/${file}`,
                importance: 6,
              });
            }
          }
        } catch { /* skip */ }
      } else {
        const content = safeReadFile(fullPath);
        if (content) {
          findings.push({
            category: "config",
            title: `${ci.label} configuration`,
            content: content,
            tags: "ci,cd,pipeline,automation",
            language: "",
            source_file: ci.path,
            importance: 6,
          });
        }
      }
    }
  }

  return findings;
}

// ── Tool handler ─────────────────────────────────────────────────────

export function scanProjectHandler(
  params: Record<string, unknown>
): ToolResult {
  try {
    const parsed = ScanProjectSchema.safeParse(params);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Validation error: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    const { repo_path } = parsed.data;

    // Verify path exists
    if (!existsSync(repo_path)) {
      return {
        content: [
          { type: "text", text: `Path not found: ${repo_path}` },
        ],
        isError: true,
      };
    }

    const stat = statSync(repo_path);
    if (!stat.isDirectory()) {
      return {
        content: [
          { type: "text", text: `Not a directory: ${repo_path}` },
        ],
        isError: true,
      };
    }

    // Detect project name from directory or param
    const projectName = parsed.data.project_name ?? basename(repo_path);

    // Detect tech stack
    const techStack = detectTechStack(repo_path);

    // Build directory summary (top 2 levels)
    const topLevel = scanDir(repo_path, 0, 2);
    const dirSummary = formatTree(topLevel);

    // Extract findings
    const findings = extractFindings(repo_path, techStack);

    // Format response
    const result: ScanResult = {
      project_name: projectName,
      repo_path: repo_path,
      detected_tech_stack: techStack.join(", ") || "unknown",
      directory_summary: dirSummary,
      findings,
    };

    const lines: string[] = [
      `Project Scan: ${result.project_name}`,
      `Path: ${result.repo_path}`,
      `Tech Stack: ${result.detected_tech_stack}`,
      "",
      "Directory Structure:",
      result.directory_summary,
      "",
      `Found ${findings.length} item(s) to potentially save:`,
      "",
    ];

    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      lines.push(
        `  ${i + 1}. [${f.category}] ${f.title}`,
        `     Source: ${f.source_file} | Importance: ${f.importance} | Tags: ${f.tags}`,
        `     Preview: ${f.content.slice(0, 120).replace(/\n/g, " ")}…`,
        "",
      );
    }

    lines.push(
      "────────────────────────────────────────",
      "Ask the user which findings to save. For each approved item,",
      `call save_context with project_name="${projectName}" and the`,
      `finding's title, content, category, tags, language, and importance.`,
      `Also call update_project to set tech_stack="${result.detected_tech_stack}".`,
    );

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scan_project] Error:", err);
    return {
      content: [
        { type: "text", text: `Error in scan_project: ${message}` },
      ],
      isError: true,
    };
  }
}
