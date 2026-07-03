---
name: ux-improvement
description: Improve product UX/UI with a strict design-engineering standard. Use for frontend polish, screen redesigns, usability audits, tables, forms, modals, overlays, typography, spacing, color, motion, accessibility, enterprise trust patterns, responsive layout, and pre-ship UX checks.
argument-hint: "[screen, component, route, flow, or UX goal]"
user-invocable: true
---

# UX Improvement

Use this skill when improving an existing product interface or building new UI that must feel production-grade, familiar, scannable, and maintainable.

## Core Standard

Follow the full Design Engineering Rulebook in `${CLAUDE_SKILL_DIR}/references/design-engineering-rulebook.md` when the task involves detailed UX decisions, audits, or shipping checks.

Use these priorities even before loading the full reference:

- Make the UI familiar before making it novel.
- Reduce cognitive load: one direction to scan, one primary action, one idea per section.
- Prefer whitespace over borders for separation.
- Preserve existing design-system patterns, component APIs, tokens, and layout conventions.
- Keep enterprise screens dense but quiet: organized information, restrained styling, clear states.
- Treat forms, tables, modals, popovers, and empty/error/loading states as first-class UX, not afterthoughts.
- Verify keyboard navigation, focus behavior, reduced motion, contrast, responsive layout, and text fit before shipping.

## Workflow

1. Read the current route/component and nearby UI primitives before editing.
2. Identify the user task, primary action, data hierarchy, and likely failure states.
3. Apply the smallest coherent UX change that improves scanability, affordance, trust, or completion speed.
4. Use existing components, icons, table patterns, form patterns, spacing tokens, and motion conventions where available.
5. Add or improve loading, empty, error, disabled, focus, hover, active, and selected states when the change touches an interactive surface.
6. Run the relevant app checks and, for visible frontend work, inspect the result in a browser or screenshot when feasible.
7. Before finishing, run the pre-ship checklist from the rulebook for every changed screen.

## Implementation Rules

- Keep typography simple: one font family, no more than three font sizes per screen, clear hierarchy.
- Keep colors semantic: primary, neutral, destructive; avoid decorative gradients and color-only status.
- Use a 4px or 8px spacing grid. Do not introduce arbitrary spacing values.
- Use exact transition properties, never `transition: all`.
- Use `ease-out` for interactive UI, except toast exits where `ease-in` is acceptable.
- Add active button feedback with `transform: scale(0.97)` unless the existing system already has equivalent behavior.
- Never use placeholders as labels; keep helper and error text below the field.
- For tables, preserve sticky headers, 48-52px rows, right-aligned actions, and dot-plus-text statuses.
- For overlays, support `Esc`, backdrop close, focus return, and focus trap for modals.
- For irreversible actions, require confirmation and provide undo where appropriate.
