#!/usr/bin/env node

/**
 * Dev Memory Viewer — lightweight web UI for browsing the knowledge base.
 *
 * Usage:
 *   npx dev-memory-viewer              # starts on http://localhost:3333
 *   npx dev-memory-viewer --port 8080  # custom port
 *   DEV_MEMORY_TOKEN=secret npx dev-memory-viewer  # require ?token=secret
 *
 * Zero new dependencies — uses Node's built-in http module.
 */

import { createServer } from "node:http";
import { parse as parseUrl } from "node:url";
import { randomBytes } from "node:crypto";
import {
  initDb,
  searchContexts,
  getContextById,
  listProjects,
  getHubStats,
  listContextHistory,
  searchSessions,
} from "./db.js";

const DEFAULT_PORT = 3333;

function getPort(): number {
  const idx = process.argv.indexOf("--port");
  if (idx !== -1 && process.argv[idx + 1]) {
    const p = parseInt(process.argv[idx + 1], 10);
    if (!isNaN(p) && p > 0) return p;
  }
  return DEFAULT_PORT;
}

function getAuthToken(): string | null {
  // If the user supplied one, honour it. Otherwise, if --no-auth is passed
  // or we're clearly running in a local dev context, generate one to print.
  if (process.env.DEV_MEMORY_TOKEN) return process.env.DEV_MEMORY_TOKEN;
  if (process.argv.includes("--no-auth")) return null;
  // Generate a per-run token so the viewer is never exposed token-less
  // by default on a shared machine. Users who don't care can pass --no-auth.
  return randomBytes(12).toString("hex");
}

const db = initDb();
const port = getPort();
const authToken = getAuthToken();

// ── API helpers ──────────────────────────────────────────────────────

function json(res: import("node:http").ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function html(res: import("node:http").ServerResponse, body: string) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

// ── Sessions query now handled by db.searchSessions ─────────────────

// ── HTTP server ──────────────────────────────────────────────────────

const server = createServer((req, res) => {
  const parsed = parseUrl(req.url ?? "/", true);
  const path = parsed.pathname ?? "/";
  const query = parsed.query;

  // Auth gate. If a token is required and the request doesn't match,
  // return 401. We accept the token either in the query string (for
  // easy bookmarks) or in an `x-auth-token` header (for API calls).
  if (authToken) {
    const provided =
      (typeof query.token === "string" ? query.token : undefined) ??
      (req.headers["x-auth-token"] as string | undefined);
    if (provided !== authToken) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized — append ?token=... to the URL");
      return;
    }
  }

  try {
    // API routes
    if (path === "/api/stats") {
      return json(res, getHubStats(db));
    }

    if (path === "/api/projects") {
      return json(res, listProjects(db));
    }

    if (path === "/api/contexts" && req.method === "GET") {
      const results = searchContexts(db, {
        query: query.query as string | undefined,
        category: query.category as string | undefined,
        project_name: query.project as string | undefined,
        technology: query.technology as string | undefined,
        limit: query.limit ? parseInt(query.limit as string, 10) : 50,
        include_deleted: query.include_deleted === "1",
      });
      return json(res, results);
    }

    if (path.startsWith("/api/contexts/")) {
      const parts = path.split("/").filter(Boolean);
      // /api/contexts/:id              -> full entry
      // /api/contexts/:id/history      -> edit history
      const id = parseInt(parts[2] ?? "", 10);
      if (isNaN(id)) return json(res, { error: "Invalid ID" }, 400);

      if (parts[3] === "history") {
        const history = listContextHistory(db, id);
        return json(res, history);
      }

      const entry = getContextById(db, id, { include_deleted: true });
      if (!entry) return json(res, { error: "Not found" }, 404);
      return json(res, entry);
    }

    if (path === "/api/trash") {
      const rows = db
        .prepare(
          `SELECT c.id, p.name AS project_name, c.title, c.category,
                  c.tags, c.importance, c.times_used, c.deleted_at,
                  substr(c.content, 1, 180) AS preview
           FROM contexts c
           JOIN projects p ON p.id = c.project_id
           WHERE c.deleted_at IS NOT NULL
           ORDER BY c.deleted_at DESC
           LIMIT 200`
        )
        .all();
      return json(res, rows);
    }

    if (path === "/api/sessions") {
      const results = searchSessions(db, {
        query: query.query as string | undefined,
        project_name: query.project as string | undefined,
        limit: query.limit ? parseInt(query.limit as string, 10) : 50,
      });
      return json(res, results);
    }

    // Serve the SPA
    if (path === "/" || path === "/index.html") {
      return html(res, VIEWER_HTML);
    }

    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    console.error("Viewer error:", err);
    json(res, { error: String(err) }, 500);
  }
});

server.listen(port, () => {
  console.log(`\n  Dev Memory Viewer`);
  console.log(`  ──────────────────`);
  if (authToken) {
    console.log(`  http://localhost:${port}?token=${authToken}\n`);
    console.log(
      `  (auth token generated per run — set DEV_MEMORY_TOKEN to override`
    );
    console.log(`   or pass --no-auth to disable)\n`);
  } else {
    console.log(`  http://localhost:${port}\n`);
    console.log(`  (auth disabled — do not expose on a shared machine)\n`);
  }
});

// ── Embedded SPA ─────────────────────────────────────────────────────

const VIEWER_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dev Memory</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=DM+Sans:wght@400;500;600;700&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg-0: #0a0a0c;
    --bg-1: #111116;
    --bg-2: #1a1a22;
    --bg-3: #24242e;
    --border: #2a2a36;
    --border-hover: #3a3a4a;
    --text-0: #e8e8ee;
    --text-1: #a8a8b8;
    --text-2: #68687a;
    --accent: #6c9cff;
    --accent-dim: #6c9cff22;
    --green: #4ade80;
    --amber: #fbbf24;
    --rose: #fb7185;
    --purple: #a78bfa;
    --mono: 'JetBrains Mono', monospace;
    --sans: 'DM Sans', -apple-system, sans-serif;
    --radius: 8px;
  }

  body {
    font-family: var(--sans);
    background: var(--bg-0);
    color: var(--text-0);
    line-height: 1.6;
    min-height: 100vh;
  }

  /* ── Layout ─────────────────────────── */
  .shell {
    display: grid;
    grid-template-columns: 220px 1fr;
    min-height: 100vh;
  }

  .sidebar {
    background: var(--bg-1);
    border-right: 1px solid var(--border);
    padding: 24px 0;
    position: sticky;
    top: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .logo {
    font-family: var(--mono);
    font-weight: 600;
    font-size: 14px;
    color: var(--accent);
    padding: 0 20px;
    margin-bottom: 32px;
    letter-spacing: -0.5px;
  }

  .logo span { color: var(--text-2); font-weight: 400; }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 20px;
    color: var(--text-1);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.15s;
    border-left: 2px solid transparent;
  }

  .nav-item:hover { color: var(--text-0); background: var(--bg-2); }
  .nav-item.active {
    color: var(--accent);
    background: var(--accent-dim);
    border-left-color: var(--accent);
  }

  .nav-icon { font-size: 16px; width: 20px; text-align: center; }

  .main {
    padding: 32px 40px;
    max-width: 1100px;
    overflow-y: auto;
  }

  .page-title {
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 24px;
    letter-spacing: -0.3px;
  }

  /* ── Stats cards ────────────────────── */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
    margin-bottom: 32px;
  }

  .stat-card {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
  }

  .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-2); margin-bottom: 6px; }
  .stat-value { font-family: var(--mono); font-size: 28px; font-weight: 600; }
  .stat-value.blue { color: var(--accent); }
  .stat-value.green { color: var(--green); }
  .stat-value.amber { color: var(--amber); }

  /* ── Search bar ─────────────────────── */
  .search-bar {
    display: flex;
    gap: 10px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }

  .search-input {
    flex: 1;
    min-width: 200px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 14px;
    color: var(--text-0);
    font-family: var(--mono);
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }

  .search-input:focus { border-color: var(--accent); }
  .search-input::placeholder { color: var(--text-2); }

  select.search-input {
    flex: 0 0 auto;
    min-width: 140px;
    cursor: pointer;
    -webkit-appearance: none;
  }

  .btn {
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: var(--radius);
    padding: 10px 20px;
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn:hover { opacity: 0.85; }

  /* ── Table ──────────────────────────── */
  .table-wrap {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  table { width: 100%; border-collapse: collapse; }

  th {
    text-align: left;
    padding: 12px 16px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-2);
    background: var(--bg-2);
    border-bottom: 1px solid var(--border);
    font-weight: 600;
  }

  td {
    padding: 12px 16px;
    font-size: 13px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }

  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--bg-2); }

  .clickable { cursor: pointer; }

  .badge {
    display: inline-block;
    font-family: var(--mono);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--bg-3);
    color: var(--text-1);
  }

  .badge.pattern { color: var(--accent); background: #6c9cff18; }
  .badge.decision { color: var(--purple); background: #a78bfa18; }
  .badge.gotcha { color: var(--rose); background: #fb718518; }
  .badge.snippet { color: var(--green); background: #4ade8018; }
  .badge.architecture { color: var(--amber); background: #fbbf2418; }
  .badge.debug { color: #f472b6; background: #f472b618; }
  .badge.config { color: #38bdf8; background: #38bdf818; }
  .badge.prompt { color: #34d399; background: #34d39918; }

  .mono { font-family: var(--mono); font-size: 12px; }
  .dim { color: var(--text-2); }
  .truncate { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ── Detail view ────────────────────── */
  .detail-panel {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px;
  }

  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 20px;
    gap: 16px;
  }

  .detail-title { font-size: 18px; font-weight: 700; }

  .detail-meta {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }

  .meta-item { font-size: 12px; color: var(--text-2); }
  .meta-item strong { color: var(--text-1); font-weight: 500; }

  .detail-content {
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.8;
    color: var(--text-1);
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg-0);
    border-radius: 6px;
    padding: 20px;
    max-height: 500px;
    overflow-y: auto;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-2);
    cursor: pointer;
    margin-bottom: 16px;
    transition: color 0.15s;
  }

  .back-link:hover { color: var(--accent); }

  /* ── Empty state ────────────────────── */
  .empty {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-2);
    font-size: 14px;
  }

  .empty-icon { font-size: 32px; margin-bottom: 12px; }

  /* ── Category chart ─────────────────── */
  .cat-bars { margin-top: 8px; }

  .cat-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
    font-size: 12px;
  }

  .cat-label { width: 90px; color: var(--text-2); font-family: var(--mono); text-align: right; }

  .cat-bar-bg {
    flex: 1;
    height: 20px;
    background: var(--bg-0);
    border-radius: 3px;
    overflow: hidden;
  }

  .cat-bar {
    height: 100%;
    border-radius: 3px;
    transition: width 0.4s ease;
  }

  .cat-count { width: 30px; font-family: var(--mono); color: var(--text-2); font-size: 11px; }

  /* ── Responsive ─────────────────────── */
  @media (max-width: 768px) {
    .shell { grid-template-columns: 1fr; }
    .sidebar { display: none; }
    .main { padding: 20px; }
  }
</style>
</head>
<body>

<div class="shell">
  <aside class="sidebar">
    <div class="logo">dev<span>/</span>memory</div>
    <div class="nav-item active" onclick="navigate('dashboard')">
      <span class="nav-icon">◉</span> Dashboard
    </div>
    <div class="nav-item" onclick="navigate('contexts')">
      <span class="nav-icon">◫</span> Contexts
    </div>
    <div class="nav-item" onclick="navigate('projects')">
      <span class="nav-icon">◧</span> Projects
    </div>
    <div class="nav-item" onclick="navigate('sessions')">
      <span class="nav-icon">◷</span> Sessions
    </div>
  </aside>

  <main class="main" id="main"></main>
</div>

<script>
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const main = $('#main');

const CAT_COLORS = {
  pattern: '#6c9cff', decision: '#a78bfa', gotcha: '#fb7185', snippet: '#4ade80',
  architecture: '#fbbf24', debug: '#f472b6', config: '#38bdf8', prompt: '#34d399', general: '#94a3b8'
};

async function api(path) {
  // Re-use the token from the page URL on every request so the SPA
  // continues to work when DEV_MEMORY_TOKEN is set.
  const token = new URLSearchParams(location.search).get('token');
  const separator = path.includes('?') ? '&' : '?';
  const url = token ? path + separator + 'token=' + encodeURIComponent(token) : path;
  const res = await fetch(url);
  return res.json();
}

function setActive(name) {
  $$('.nav-item').forEach(el => el.classList.remove('active'));
  $$('.nav-item').forEach(el => {
    if (el.textContent.trim().toLowerCase() === name) el.classList.add('active');
  });
}

// ── Dashboard ──────────────────────────
async function renderDashboard() {
  setActive('dashboard');
  const stats = await api('/api/stats');
  const catEntries = Object.entries(stats.categories || {}).sort((a,b) => b[1] - a[1]);
  const maxCat = catEntries.length ? catEntries[0][1] : 1;

  main.innerHTML = \`
    <div class="page-title">Dashboard</div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Projects</div>
        <div class="stat-value blue">\${stats.total_projects}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Contexts</div>
        <div class="stat-value green">\${stats.total_contexts}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Categories Used</div>
        <div class="stat-value amber">\${catEntries.length}</div>
      </div>
    </div>

    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 16px;">
      <div class="stat-card">
        <div class="stat-label" style="margin-bottom:12px">Contexts by Category</div>
        <div class="cat-bars">
          \${catEntries.map(([cat, count]) => \`
            <div class="cat-row">
              <div class="cat-label">\${cat}</div>
              <div class="cat-bar-bg">
                <div class="cat-bar" style="width:\${(count/maxCat)*100}%; background:\${CAT_COLORS[cat] || '#94a3b8'}"></div>
              </div>
              <div class="cat-count">\${count}</div>
            </div>
          \`).join('')}
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-label" style="margin-bottom:12px">Most Used</div>
        \${stats.top_used.length === 0 ? '<div class="dim" style="font-size:13px">No entries yet</div>' :
          stats.top_used.map(e => \`
            <div style="margin-bottom:10px; cursor:pointer;" onclick="viewContext(\${e.id})">
              <div style="font-size:13px; font-weight:500;">\${esc(e.title)}</div>
              <div style="font-size:11px; color:var(--text-2)">
                <span class="badge \${e.category}">\${e.category}</span>
                &nbsp; used \${e.times_used}x &nbsp;·&nbsp; \${esc(e.project_name)}
              </div>
            </div>
          \`).join('')}
      </div>
    </div>
  \`;
}

// ── Contexts ───────────────────────────
let lastSearch = {};

async function renderContexts(opts = {}) {
  setActive('contexts');
  lastSearch = opts;
  const params = new URLSearchParams();
  if (opts.query) params.set('query', opts.query);
  if (opts.category) params.set('category', opts.category);
  if (opts.project) params.set('project', opts.project);
  if (opts.technology) params.set('technology', opts.technology);
  params.set('limit', '100');

  const hasFilter = opts.query || opts.category || opts.project || opts.technology;
  const results = hasFilter ? await api('/api/contexts?' + params) : [];
  const projects = await api('/api/projects');

  main.innerHTML = \`
    <div class="page-title">Contexts</div>
    <div class="search-bar">
      <input class="search-input" id="q" placeholder="Search contexts..." value="\${esc(opts.query || '')}" onkeydown="if(event.key==='Enter')doSearch()">
      <select class="search-input" id="cat">
        <option value="">All categories</option>
        \${['pattern','decision','gotcha','snippet','architecture','prompt','debug','config','general'].map(c =>
          '<option value="'+c+'" '+(opts.category===c?'selected':'')+'>'+c+'</option>'
        ).join('')}
      </select>
      <select class="search-input" id="proj">
        <option value="">All projects</option>
        \${projects.map(p => '<option value="'+esc(p.name)+'" '+(opts.project===p.name?'selected':'')+'>'+esc(p.name)+'</option>').join('')}
      </select>
      <input class="search-input" id="tech" style="max-width:150px" placeholder="Technology..." value="\${esc(opts.technology || '')}">
      <button class="btn" onclick="doSearch()">Search</button>
    </div>
    \${!hasFilter ? \`
      <div class="empty">
        <div class="empty-icon">◫</div>
        Enter a search query or select filters to browse contexts
      </div>
    \` : results.length === 0 ? \`
      <div class="empty">
        <div class="empty-icon">∅</div>
        No results found
      </div>
    \` : \`
      <div class="table-wrap">
        <table>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Category</th>
            <th>Project</th>
            <th>Importance</th>
            <th>Used</th>
          </tr>
          \${results.map(r => \`
            <tr class="clickable" onclick="viewContext(\${r.id})">
              <td class="mono dim">\${r.id}</td>
              <td>\${esc(r.title)}</td>
              <td><span class="badge \${r.category}">\${r.category}</span></td>
              <td class="mono" style="font-size:12px">\${esc(r.project_name)}</td>
              <td class="mono">\${r.importance}</td>
              <td class="mono">\${r.times_used}x</td>
            </tr>
          \`).join('')}
        </table>
      </div>
      <div style="margin-top:12px; font-size:12px; color:var(--text-2)">\${results.length} result(s)</div>
    \`}
  \`;
}

function doSearch() {
  renderContexts({
    query: $('#q')?.value || '',
    category: $('#cat')?.value || '',
    project: $('#proj')?.value || '',
    technology: $('#tech')?.value || '',
  });
}

async function viewContext(id) {
  const entry = await api('/api/contexts/' + id);
  if (entry.error) return;

  main.innerHTML = \`
    <div class="back-link" onclick="renderContexts(lastSearch)">← Back to results</div>
    <div class="detail-panel">
      <div class="detail-header">
        <div class="detail-title">\${esc(entry.title)}</div>
        <span class="badge \${entry.category}">\${entry.category}</span>
      </div>
      <div class="detail-meta">
        <div class="meta-item">Project: <strong>\${esc(entry.project_name)}</strong></div>
        <div class="meta-item">Importance: <strong>\${entry.importance}/10</strong></div>
        <div class="meta-item">Used: <strong>\${entry.times_used}x</strong></div>
        \${entry.tags ? '<div class="meta-item">Tags: <strong>'+esc(entry.tags)+'</strong></div>' : ''}
        \${entry.language ? '<div class="meta-item">Language: <strong>'+esc(entry.language)+'</strong></div>' : ''}
        \${entry.file_path ? '<div class="meta-item">File: <strong>'+esc(entry.file_path)+'</strong></div>' : ''}
        <div class="meta-item">Created: <strong>\${entry.created_at}</strong></div>
        <div class="meta-item">Updated: <strong>\${entry.updated_at}</strong></div>
      </div>
      <div class="detail-content">\${esc(entry.content)}</div>
    </div>
  \`;
}

// ── Projects ───────────────────────────
async function renderProjects() {
  setActive('projects');
  const projects = await api('/api/projects');

  main.innerHTML = \`
    <div class="page-title">Projects</div>
    \${projects.length === 0 ? \`
      <div class="empty">
        <div class="empty-icon">◧</div>
        No projects yet. Save a context to auto-create one.
      </div>
    \` : \`
      <div class="table-wrap">
        <table>
          <tr>
            <th>Name</th>
            <th>Tech Stack</th>
            <th>Description</th>
            <th>Contexts</th>
          </tr>
          \${projects.map(p => \`
            <tr class="clickable" onclick="renderContexts({project: '\${esc(p.name)}'})">
              <td style="font-weight:600">\${esc(p.name)}</td>
              <td class="mono" style="font-size:12px">\${esc(p.tech_stack) || '<span class="dim">—</span>'}</td>
              <td style="max-width:300px">\${esc(p.description) || '<span class="dim">—</span>'}</td>
              <td class="mono">\${p.context_count}</td>
            </tr>
          \`).join('')}
        </table>
      </div>
    \`}
  \`;
}

// ── Sessions ───────────────────────────
async function renderSessions() {
  setActive('sessions');
  const sessions = await api('/api/sessions');

  main.innerHTML = \`
    <div class="page-title">Sessions</div>
    \${sessions.length === 0 ? \`
      <div class="empty">
        <div class="empty-icon">◷</div>
        No sessions logged yet.
      </div>
    \` : \`
      <div class="table-wrap">
        <table>
          <tr>
            <th>ID</th>
            <th>Project</th>
            <th>Summary</th>
            <th>Outcome</th>
            <th>Contexts Used</th>
            <th>Date</th>
          </tr>
          \${sessions.map(s => \`
            <tr>
              <td class="mono dim">\${s.id}</td>
              <td class="mono" style="font-size:12px">\${esc(s.project_name)}</td>
              <td style="max-width:350px">\${esc(s.summary)}</td>
              <td><span class="badge">\${esc(s.outcome) || '—'}</span></td>
              <td class="mono dim">\${s.contexts_used}</td>
              <td class="mono dim" style="font-size:11px; white-space:nowrap">\${s.created_at}</td>
            </tr>
          \`).join('')}
        </table>
      </div>
    \`}
  \`;
}

// ── Router ─────────────────────────────
function navigate(page, opts) {
  const routes = { dashboard: renderDashboard, contexts: renderContexts, projects: renderProjects, sessions: renderSessions };
  (routes[page] || renderDashboard)(opts);
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Boot
renderDashboard();
</script>
</body>
</html>`;
