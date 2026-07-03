# Code Cleanup Guide

Use this skill for cleanup and stabilization work in this repository.

## Table of Contents

- [Repo Map](#repo-map)
- [Official Docs](#official-docs)
- [Business Context](#business-context)
- [Start Every Pass](#start-every-pass)
- [Hard Invariants](#hard-invariants)
- [Stack-Specific Rules](#stack-specific-rules)
- [Cleanup Lanes](#cleanup-lanes)
- [Commands](#commands)
- [Pre-Commit Hook](#pre-commit-hook)
- [Commit Rules](#commit-rules)
- [Bug Search Checklist](#bug-search-checklist)
- [Final Report](#final-report)

## Repo Map

- `apps/frontend`: Vite, React, TanStack Router/Query, oRPC client, Tailwind/shadcn-style UI.
- `apps/api-gateway`: Bun server, oRPC routers, Drizzle, BullMQ workers, AI extraction/matching, catalogue, pricing, enquiries, quotes, stock, purchase orders.
- `apps/auth`: Better Auth magic-link auth, JWT/JWKS, org/session role stamping.
- `packages/api-contracts`: type-only `AppRouter` bridge for client/server safety.
- `packages/email`: React Email templates and email sending.

## Official Docs

Use primary docs when changing behavior or when unsure about an API:

- Bun workspaces: https://bun.sh/docs/install/workspaces
- Turborepo: https://turbo.build/repo/docs
- Vite build options: https://vite.dev/config/build-options.html
- React hooks: https://react.dev/reference/react/hooks
- React `memo`: https://react.dev/reference/react/memo
- React `useMemo`: https://react.dev/reference/react/useMemo
- React `useCallback`: https://react.dev/reference/react/useCallback
- React Doctor: https://www.react.doctor/docs
- Vercel AI SDK: https://ai-sdk.dev/docs
- Vercel AI SDK introduction: https://ai-sdk.dev/docs/introduction
- Vercel agents with AI SDK: https://vercel.com/docs/agents
- TanStack Router: https://tanstack.com/router/router/docs
- TanStack Query: https://tanstack.com/query/latest/docs/react/
- TanStack Table: https://tanstack.com/table/latest/docs/framework/react/react-table
- oRPC: https://orpc.dev/docs/getting-started
- oRPC OpenAPI: https://orpc.dev/docs/openapi/openapi-specification
- Better Auth installation: https://better-auth.com/docs/installation
- Better Auth plugins: https://better-auth.com/docs/plugins
- Better Auth magic link: https://better-auth.com/docs/plugins/magic-link
- Better Auth organization: https://better-auth.com/docs/plugins/organization
- Better Auth security: https://www.better-auth.com/docs/reference/security
- Drizzle ORM: https://orm.drizzle.team/docs
- Drizzle migrations: https://orm.drizzle.team/docs/migrations
- Redgate DECIMAL for money values: https://www.red-gate.com/blog/how-to-use-decimal-data-type-tip/
- BullMQ workers/concurrency: https://docs.bullmq.io/guide/workers/concurrency
- Vercel AI Gateway: https://vercel.com/docs/ai-gateway/
- Vercel Blob: https://vercel.com/docs/vercel-blob
- React Hook Form: https://www.react-hook-form.com/
- Zod: https://zod.dev/
- Husky: https://typicode.github.io/husky/
- Oxlint: https://oxc.rs/docs/guide/usage/linter.html
- Oxfmt: https://oxc.rs/docs/guide/usage/formatter.html

## Business Context

The product turns supplier price lists into reviewed catalogue gold data, then powers customer pricing, enquiries, quotations, stock checks, purchase orders, supplier/customer portals, and NLQ catalogue querying.

Cleanup must protect pricing correctness, tenant isolation, auth boundaries, quote immutability, staged-review safety, AI extraction cost/retry behavior, and audit/history data.

## Start Every Pass

1. Run `git status --short --branch`.
2. Read the relevant scripts/config before editing:
   - root `package.json`
   - workspace package scripts
   - `turbo.json`
   - `tsconfig.base.json`
   - `.oxlintrc.json`
   - `.oxfmtrc.toml`
   - `apps/frontend/vite.config.ts`
   - `apps/frontend/tsr.config.json`
   - relevant auth, env, oRPC, router, route, worker, and Drizzle files
3. Build a quick map for the touched flow:
   - UI route/component
   - TanStack guard/loader/query
   - oRPC client call
   - API router/schema
   - DB table, worker, email, or external side effect
4. Check for existing user changes and preserve them.

## Hard Invariants

- Never expose `apps/auth` server logic, secrets, env validation, DB clients, or backend utilities to frontend bundles.
- Frontend must import API types through `@vasavi/api-contracts`, not directly from `@vasavi/api-gateway`.
- Preserve oRPC input/output contracts unless fixing a confirmed bug.
- Preserve tenant scoping:
  - staff data uses shared org tenant context
  - customer portal access stays customer-scoped
  - supplier portal access stays supplier-scoped
- Preserve soft-delete/history behavior for customers, suppliers, catalogue, enquiries, quotes, purchase orders, and audit events.
- Preserve quote price snapshots and quotation lifecycle semantics.
- Do not delete routes, procedures, schemas, columns, migrations, or files without proving they are unused.
- Treat AI extraction, matching, embeddings, rerank, queue retry, and idempotency logic as high-risk.
- Treat money, price, quantity, tax, discount, subtotal, grand total, purchase cost, and PO total calculations as high-risk data processing.
- Do not add `useMemo` or `useCallback` broadly; add them only when React Doctor/profiling or clear prop stability issues justify it.
- Do not add explanatory comments unless they protect serious business logic, security decisions, auth/session behavior, API contracts, money/pricing rules, migration rationale, worker retry/idempotency, or non-obvious edge cases.
- Remove comments that repeat the code or narrate implementation mechanics.

## Stack-Specific Rules

### Bun and Turborepo

- Keep workspace boundaries intact; prefer root scripts for whole-repo gates and `--cwd` package scripts for focused checks.
- Do not hand-edit `bun.lock` except through package manager operations.
- Treat `turbo.json` task dependencies as part of verification behavior; changing them changes every agent's safety net.
- Keep generated/build output out of commits unless the repo intentionally tracks it.

### TanStack Router

- Preserve file route names, route groups, pathless layouts, and `page`/`layout` route tokens.
- Run frontend typecheck after route changes because it runs `tsr generate && tsc --noEmit`.
- Keep `beforeLoad` guards explicit for staff, supplier, and customer surfaces.
- Do not move auth decisions out of route guards unless the replacement keeps redirect behavior and query preloading clear.
- Avoid hiding route data dependencies in helpers when that makes loader/action behavior harder to audit.

### TanStack Query and oRPC Client

- Use generated oRPC query/mutation options instead of hand-written fetch clients.
- Invalidate or update the narrowest useful query after mutations; do not clear the whole cache unless signing out or switching account context.
- Keep query keys and mutation side effects aligned with tenant and portal boundaries.
- Do not duplicate API response DTO shaping in the client when the router schema already owns it.

### oRPC API

- Keep procedures grouped by domain router and export only through `apps/api-gateway/src/routers/index.ts`.
- Keep Zod schemas near their router domain; extract only when reused by multiple routers.
- Preserve route method/path/tag metadata because it feeds OpenAPI.
- Convert thrown domain failures to meaningful `ORPCError`s; do not leak raw provider, DB, or auth errors to users.
- Keep `@vasavi/api-contracts` type-only and free of runtime server dependencies.

### Better Auth

- Keep server auth config in `apps/auth`; keep frontend auth client helpers in `apps/frontend/src/lib`.
- Preserve magic-link-only login and server-side provisioning assumptions.
- Preserve session hook role stamping: account role lives on user, org role lives on session.
- Keep staff, supplier, and customer redirects separate; do not assume any logged-in user is staff.
- Be conservative with cookies, CORS, trusted origins, JWT/JWKS, and bearer fallback changes.

### Drizzle, Postgres, and Migrations

- Do not edit historical migrations unless explicitly repairing a local-only migration before it is shared.
- Add new migrations for schema changes and keep schema barrels importable by drizzle-kit.
- Use transactions for multi-row lifecycle changes: promotion, quote generation, confirmation, stock dispatch, PO drafting.
- Preserve numeric money values as strings/decimal-safe values at DB boundaries.
- Keep read-only NLQ SQL guarded and scoped; never let chat write to the DB.

### Money, Pricing, and Decimal Data

- JavaScript `number` is binary floating point; do not introduce new money math that depends on implicit float precision.
- Treat Postgres `numeric` plus Zod-validated string DTOs as the repo's decimal boundary. Keep money values as strings across DB/API/UI boundaries unless a calculation helper explicitly owns conversion and rounding.
- In Drizzle schemas, use Postgres `numeric(precision, scale)` for money, totals, quantities, rates, percentages, match scores, and other decimal data; do not introduce `real`, `double precision`, or float-like columns for business values.
- In Zod schemas, validate decimal strings with explicit scale and range before persistence. Prefer named reusable schemas such as `moneyString`, `quantityString`, `percentString`, or domain-specific variants over repeated ad hoc regexes.
- Keep API output schemas for money as strings that mirror Drizzle `numeric` output. Do not coerce API money outputs to JS numbers just for convenience.
- Never use `float`, `double precision`, unchecked `Number(...)`, `parseFloat`, or casual `toFixed()` as the source of truth for persisted money.
- Round explicitly at business boundaries: line total, subtotal, tax, discount, grand total, purchase-order line total, and persisted quote/PO snapshots.
- Do not round repeatedly inside intermediate steps unless the business rule requires it; repeated rounding can change totals.
- Keep scale explicit:
  - prices, MRP, purchase price, subtotal, tax, and totals: 2 decimal places
  - quantities: 3 decimal places where the schema allows fractional quantities
  - pricing rule percentages/values: preserve the schema's configured precision
- Keep frontend form values as strings until validation/submission. Convert only at the narrow boundary expected by the API schema.
- For Zod form schemas, reject empty strings, `NaN`, `Infinity`, currency symbols, comma-formatted values, excess decimal places, and negative values unless the specific business flow permits them.
- For imported/AI-extracted data, use Zod or a shared normalizer to turn raw values into canonical decimal strings before database writes.
- Use display formatting only for display. `Intl.NumberFormat`, `toFixed`, and formatted rupee strings must not feed back into calculations.
- When importing AI/extracted price-list data, normalize to canonical decimal strings before persistence/contracts; reject or flag ambiguous currency, malformed amounts, negative prices, or impossible quantities.
- Preserve quote immutability: confirmed/sent quote prices are snapshots and must not drift after catalogue, customer override, supplier cost, or pricing-rule changes.
- If a refactor touches pricing math, prefer a decimal library or integer minor-unit strategy over expanding ad hoc JS number arithmetic.
- For money changes, manually verify edge cases and report test gaps: `.005` rounding, large totals, percentage discounts, fixed discounts, GST/tax, zero/blank/null values, negative inputs, and mixed quantity scales. Do not add test files unless explicitly requested.

### BullMQ, Redis, and Workers

- Preserve at-least-once retry assumptions; all worker writes must be idempotent or explicitly safe on retry.
- Do not increase concurrency around AI/provider calls without checking rate limits and cost.
- Keep failed job status messages sanitized.
- Do not let a worker retry undo human review, approval, rejection, or quote/order lifecycle decisions.

### AI Extraction and Matching

- Treat prompt, schema, normalization, embedding, rerank, and match-threshold changes as behavior changes.
- Preserve universal product fields used by staging, catalogue, pricing, and BOQ matching.
- Keep parse/extract job IDs and resume behavior safe for retries.
- Avoid deleting extraction variants or provider config without proving no env/script/runtime usage remains.
- Check cost and latency impact before adding extra model calls.

### Vercel AI SDK and Agentic Flows

- Treat `ai`, `@ai-sdk/react`, and `@ai-sdk/gateway` as the agentic/model/tooling layer, not a generic fetch wrapper.
- Use AI SDK primitives consistently for model calls, streaming, structured objects, tools, and multi-step agent loops.
- Preserve tool-call boundaries: tools must have narrow inputs, validated outputs, and safe server-side side effects.
- Keep provider/model config env-driven where the repo already does so.
- Track cost, latency, retries, rate limits, prompt content, and token usage when changing model orchestration.
- Do not move AI SDK calls into the client unless the data, credentials, and side effects are explicitly safe for the browser.
- Keep prompts and schemas versionable and reviewable; changes to them are product behavior changes.

### React UI, Forms, and Tables

- Prefer derived values over redundant React state.
- Fix invalid hook dependencies; never silence dependency issues without a clear reason.
- Use React Hook Form for form state when the existing form pattern already uses it.
- Keep TanStack Table column definitions stable when instability causes real re-renders; otherwise avoid premature memoization.
- Keep virtualized tables dimensionally stable so rows, cells, and loading states do not resize unpredictably.
- Use existing shadcn/Radix/lucide patterns before creating new UI primitives.

### Email, Blob, and External Services

- Treat email templates as customer-facing business communication; preserve quote/account semantics.
- Avoid logging tokens, magic links, signed URLs, uploaded file contents, or AI prompts containing sensitive customer data.
- Keep Vercel Blob delete/upload behavior aligned with document lifecycle; promoted catalogue data must survive upload deletion where intended.

### Docker and Env

- Keep `.env.example` synchronized with env schema changes.
- Do not add required env vars without defaults or documentation.
- Keep app, auth, Redis, Postgres, and pgvector port assumptions aligned with `docker-compose.yml` and README.

## Cleanup Lanes

Work in small commits by lane. Do not mix unrelated domains.

1. Repo hygiene: unused imports, unused locals, dead comments, obvious formatting, no behavior changes.
2. Frontend routes/layouts: TanStack route files, route guards, app shell, staff/customer/supplier portals.
3. Frontend components/hooks: split only large ownership-confusing components, remove redundant state, fix hook dependencies, improve table/form ergonomics.
4. oRPC routers by domain: documents, staging, catalog, chat, customers, pricing, enquiries, quotations, stock, purchase orders, suppliers, supplier portal, customer portal.
5. Auth/security: Better Auth server, client auth helpers, JWT cache, guards, CORS, rate limits, cookie assumptions.
6. AI/workers: extraction, normalization, matching, embeddings, rerank, queue retry/idempotency, sanitized status messages.
7. Data layer: Drizzle schema imports, query duplication, transactions, null handling, missing awaits, swallowed errors.
8. Bundle/perf: address large chunks and React render issues only after correctness is stable.
9. Tests/tooling: if tests are missing, report the gap. Do not introduce a test framework or add test files as part of cleanup unless the user explicitly asks for tests.

## Commands

Use the narrowest relevant checks after each commit:

```bash
bun run --cwd apps/frontend typecheck
bun run --cwd apps/frontend lint
bun run --cwd apps/frontend format:check
bun run --cwd apps/frontend build
```

```bash
bun run --cwd apps/api-gateway typecheck
bun run --cwd apps/api-gateway lint
bun run --cwd apps/api-gateway format:check
bun run --cwd apps/api-gateway build
```

```bash
bun run --cwd apps/auth typecheck
bun run --cwd apps/auth lint
bun run --cwd apps/auth format:check
bun run --cwd apps/auth build
```

For shared packages, run their `typecheck`, `lint`, and `format:check`.

Final verification:

```bash
bunx turbo run typecheck lint format:check --force
bunx turbo run build --force
bun run doctor:all
```

Also run any configured tests. Use `bun run doctor:score` to capture the React Doctor score when reporting before/after.

## Pre-Commit Hook

The repo hook is `.husky/pre-commit`. It must remain a reliable agentic-coding gate:

```bash
git diff --cached --check
bun run verify:commit
```

`verify:commit` runs typecheck, lint, format check, staged React Doctor, and build. Do not weaken this hook for convenience. If it fails, fix the underlying issue before committing. Use `git commit --no-verify` only for an explicit emergency or when the user directly asks for it.

## Commit Rules

- Check `git status --short --branch` before each pass.
- Commit small, safe slices.
- Run relevant checks before committing and after committing.
- Use conventional commit messages, for example:
  - `chore(cleanup): remove unused frontend imports`
  - `refactor(pricing): isolate rule form helpers`
  - `fix(auth): preserve supplier redirect on stale session`
- Do not commit unrelated user changes.

## Bug Search Checklist

Look for:

- missing `await`
- swallowed errors
- bad null handling
- race-prone double submits
- broken route imports or generated route assumptions
- incorrect auth/session assumptions
- client imports of server-only code
- duplicated validation schemas
- duplicated fetch/client logic
- destructive deletes where soft-delete/history is expected
- quote/order mutations that violate immutable snapshot assumptions
- worker retry paths that duplicate staged rows or undo reviewer decisions

## Final Report

Include:

- business areas touched
- dead code removed
- bugs fixed
- structure improvements
- commands run and pass/fail status
- React Doctor before/after score, or `not configured`
- bundle/performance notes
- remaining risks and test gaps
