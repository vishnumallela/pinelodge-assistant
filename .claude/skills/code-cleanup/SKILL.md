---
name: code-cleanup
description: Clean, stabilize, modularize, and verify this Bun + Turborepo app. Use for cleanup, refactor, lint, format, typecheck, React/TanStack Router, oRPC, Better Auth, Drizzle, AI extraction, catalogue, pricing, enquiry-to-PO, and post-commit verification work in this repo.
argument-hint: "[scope, commit hash, branch, or cleanup goal]"
user-invocable: true
---

# Code Cleanup

Use this skill for cleanup and stabilization work in this repository.

## Core Standard

Follow the full Code Cleanup Guide in `${CLAUDE_SKILL_DIR}/references/code-cleanup-guide.md` when the task involves refactors, cleanup, lint/typecheck/build fixes, API/UI contract changes, data-layer edits, auth changes, AI extraction, pricing, enquiry-to-PO, or commit verification.

Use these priorities even before loading the full reference:

- Preserve pricing correctness, tenant isolation, auth boundaries, quote immutability, audit/history data, and staged-review safety.
- Keep edits narrow and lane-based; do not mix unrelated cleanup domains.
- Prefer existing repo patterns, workspace boundaries, generated contracts, and local helpers over new abstractions.
- Treat money, decimal values, migrations, auth, worker retries, AI extraction, and lifecycle changes as high risk.
- Verify with the narrowest relevant commands first, then broader repo checks when the change crosses shared contracts.
- Preserve user changes in the working tree and do not commit unrelated files.

## Workflow

1. Run `git status --short --branch`.
2. Read the touched route/component/router/schema/worker/config and the relevant package scripts before editing.
3. Build a quick flow map: UI route, guard/loader/query, oRPC call, API router/schema, DB table, worker, email, or external side effect.
4. Apply the smallest safe cleanup or refactor that improves correctness, maintainability, typing, or verification.
5. Keep behavior stable unless fixing a confirmed bug; preserve public contracts unless the request explicitly changes them.
6. Run focused checks for the touched workspace, then broader checks for shared or cross-package changes.
7. Report the touched business area, commands run, pass/fail status, remaining risk, and test gaps.

## Implementation Rules

- Never expose server-only auth, secrets, env validation, DB clients, backend utilities, or provider credentials to frontend bundles.
- Frontend imports API types through `@vasavi/api-contracts`, not directly from server packages.
- Keep tenant scoping explicit across staff, customer, and supplier surfaces.
- Preserve soft-delete/history behavior and immutable quote/order snapshots.
- Do not edit historical migrations unless explicitly repairing a local-only migration before it is shared.
- Keep money and quantity values decimal-safe across DB/API/UI boundaries.
- Keep workers idempotent under retries and do not let retries undo human review or lifecycle decisions.
- Do not weaken `.husky/pre-commit`, `verify:commit`, or generated route/type safety for convenience.
- Add comments only when they protect non-obvious business, security, lifecycle, migration, worker, or money/pricing logic.
