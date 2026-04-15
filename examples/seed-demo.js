#!/usr/bin/env node

/**
 * Seed the Dev Memory with demo data across 4 projects.
 *
 * Usage:
 *   npm run build
 *   node examples/seed-demo.js
 *   npm run viewer
 */

import { initDb, saveContext, updateProject, logSession } from "../dist/db.js";

const db = initDb();

const entries = [
  {
    project_name: "frontend-app",
    title: "React hydration mismatch fix",
    content:
      "When using SSR with React 18, hydration mismatches occur if Date.now() is called during render. Solution: move time-dependent logic into useEffect or use suppressHydrationWarning for cosmetic differences only. Root cause is server/client rendering different values for non-deterministic expressions.",
    category: "gotcha",
    tags: "react,ssr,hydration",
    language: "typescript",
    importance: 8,
  },
  {
    project_name: "frontend-app",
    title: "Redux Toolkit async thunk pattern",
    content:
      "Standard pattern for API calls: createAsyncThunk with builder.addCase for pending/fulfilled/rejected. Always normalize the response in the fulfilled reducer. Use RTK Query for new endpoints — only use thunks for complex orchestration across multiple slices.",
    category: "pattern",
    tags: "redux,rtk,async",
    language: "typescript",
    importance: 7,
  },
  {
    project_name: "frontend-app",
    title: "Webpack 5 module federation setup",
    content:
      "Module federation config for micro-frontend architecture. Host app exposes shared React/Redux instances. Remote apps consume via remoteEntry.js. Critical: shared dependencies must have singleton: true and requiredVersion matching the host. Eager loading causes duplicate React instances.",
    category: "architecture",
    tags: "webpack,module-federation,micro-frontend",
    language: "typescript",
    importance: 9,
  },
  {
    project_name: "api-gateway",
    title: "JWT validation middleware",
    content:
      "Express middleware that validates JWT tokens from Authorization header. Uses jsonwebtoken library with RS256. Public key loaded from JWKS endpoint on startup, cached for 1 hour. Returns 401 for missing/expired tokens, 403 for insufficient scopes. Always validate iss and aud claims.",
    category: "pattern",
    tags: "jwt,auth,middleware,express",
    language: "typescript",
    importance: 9,
  },
  {
    project_name: "api-gateway",
    title: "Rate limiting with sliding window",
    content:
      "Implemented sliding window rate limiter using Redis sorted sets. Each request adds a timestamp entry, ZRANGEBYSCORE counts requests in the window. More accurate than fixed window, prevents burst at window boundaries. Config: 100 req/min for authenticated, 20 req/min for anonymous.",
    category: "pattern",
    tags: "rate-limiting,redis,api",
    language: "typescript",
    importance: 7,
  },
  {
    project_name: "api-gateway",
    title: "CORS preflight caching gotcha",
    content:
      "Chrome caches CORS preflight responses for up to 2 hours (Access-Control-Max-Age). If you change allowed origins or methods, users won't see the update until cache expires. Workaround: set max-age to 300 (5 min) in development. Production can use 3600.",
    category: "gotcha",
    tags: "cors,caching,chrome",
    importance: 6,
  },
  {
    project_name: "payment-service",
    title: "Stripe idempotency key strategy",
    content:
      "Always send Idempotency-Key header for payment creation. Key format: {user_id}:{cart_hash}:{timestamp_bucket}. Timestamp bucket is floored to 5-minute intervals to handle retries within a window. Stripe retains keys for 24 hours. Without this, network retries can create duplicate charges.",
    category: "pattern",
    tags: "stripe,payments,idempotency",
    language: "typescript",
    importance: 10,
  },
  {
    project_name: "payment-service",
    title: "Webhook signature verification",
    content:
      "Stripe webhooks must be verified using stripe.webhooks.constructEvent with the raw body (not parsed JSON). Express middleware ordering matters — the webhook route must use express.raw() before express.json(). Failing to verify signatures allows forged webhook attacks.",
    category: "gotcha",
    tags: "stripe,webhooks,security",
    language: "typescript",
    importance: 9,
  },
  {
    project_name: "payment-service",
    title: "Decision: PostgreSQL over DynamoDB for transactions",
    content:
      "Chose PostgreSQL for the payment service over DynamoDB. Rationale: ACID transactions are critical for financial data, complex joins needed for reconciliation reports, and the team has deeper SQL expertise. DynamoDB was considered for scalability but we don't expect >10k TPS and RDS handles that fine. Revisit if we hit scaling issues.",
    category: "decision",
    tags: "postgresql,dynamodb,database",
    importance: 8,
  },
  {
    project_name: "ml-pipeline",
    title: "Feature store caching strategy",
    content:
      "Redis-backed feature cache with 15-minute TTL for real-time features. Batch features recomputed nightly and stored in Parquet on S3. Cache miss falls back to on-demand computation with a 30-second timeout. Monitor cache hit rate — below 85% indicates feature drift or schema change.",
    category: "architecture",
    tags: "redis,feature-store,ml,caching",
    language: "python",
    importance: 7,
  },
  {
    project_name: "ml-pipeline",
    title: "Model versioning with MLflow",
    content:
      "All models registered in MLflow with semantic versioning. Production promotion requires: (1) A/B test results showing >= baseline metrics, (2) data drift check passing, (3) latency benchmark under 100ms p99. Staging models auto-deploy to shadow environment for 48h before promotion.",
    category: "config",
    tags: "mlflow,versioning,deployment",
    language: "python",
    importance: 8,
  },
  {
    project_name: "frontend-app",
    title: "Cypress E2E test authentication pattern",
    content:
      "Instead of logging in through the UI in every test, use cy.request to hit the auth API directly and set the token in localStorage. Cuts E2E test time by 40%. Use a test-only API endpoint that bypasses MFA. Never hardcode credentials — load from cypress.env.json which is gitignored.",
    category: "snippet",
    tags: "cypress,testing,auth,e2e",
    language: "typescript",
    importance: 6,
  },
];

for (const e of entries) {
  saveContext(db, { ...e, importance: e.importance ?? 5 });
}

updateProject(db, "frontend-app", {
  tech_stack: "react, typescript, redux, webpack, styled-components",
  description: "Customer-facing SPA",
});
updateProject(db, "api-gateway", {
  tech_stack: "typescript, express, redis, jwt",
  description: "API gateway and auth layer",
});
updateProject(db, "payment-service", {
  tech_stack: "typescript, stripe, postgresql",
  description: "Payment processing service",
});
updateProject(db, "ml-pipeline", {
  tech_stack: "python, mlflow, redis, s3",
  description: "ML feature store and model serving",
});

logSession(db, {
  project_name: "frontend-app",
  summary:
    "Fixed hydration mismatch in checkout page SSR, refactored date formatting to useEffect",
  outcome: "resolved",
  context_ids_used: [1],
});
logSession(db, {
  project_name: "payment-service",
  summary:
    "Implemented Stripe webhook handler with signature verification, added idempotency keys to charge creation",
  outcome: "resolved",
  context_ids_used: [7, 8],
});
logSession(db, {
  project_name: "api-gateway",
  summary:
    "Investigated CORS issues in staging, updated preflight cache headers",
  outcome: "resolved",
  context_ids_used: [6],
});

db.close();

console.log("");
console.log("  Demo data seeded successfully!");
console.log("  ────────────────────────────");
console.log("  12 contexts across 4 projects");
console.log("  3 session logs");
console.log("");
console.log("  Run the viewer:  npm run viewer");
console.log("");
