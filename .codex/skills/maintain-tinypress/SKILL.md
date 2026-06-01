---
name: maintain-tinypress
description: Maintain, extend, review, and validate the TinyPress Tauri desktop app. Use for TinyPress product changes, React UI work, Rust compression-engine edits, settings or task-record schema changes, component consistency audits, release preparation, and regression verification.
---

# Maintain TinyPress

Work from repository truth. Read the affected React page, shared component, Rust command, settings model, and nearby tests before editing.

## Contracts

Read [references/product-contracts.md](references/product-contracts.md) before changing compression behavior, settings, task records, or retry flows.

Read [references/ui-conventions.md](references/ui-conventions.md) before changing frontend markup or styles.

Read [references/validation-matrix.md](references/validation-matrix.md) before final verification.

## Workflow

1. Inspect existing staged and unstaged changes. Preserve unrelated work.
2. Prefer existing shared components and data helpers. Add a shared component when two business pages would otherwise repeat the same control pattern.
3. Keep Rust behavior and UI copy aligned. Do not expose a control unless the encoder path truly honors it.
4. Version incompatible settings exports and localStorage records explicitly. Do not silently migrate deprecated product models unless the task requires migration.
5. Update focused tests with each behavior change.
6. Run `node .codex/skills/maintain-tinypress/scripts/audit-conventions.mjs`.
7. Run the checks selected from the validation matrix. For frontend changes, inspect the local app in light and dark mode at desktop and narrow widths.

## Guardrails

- Keep the task center focused on records and comparisons. Compression dispatch belongs to the image and audio pages.
- Keep Tinify API behavior distinct from local compression behavior.
- Use `AppSelectField` for labeled select controls in business pages.
- Keep page headers compact and consistent.
- Keep task completion, pause, retry, backup, and record persistence behavior covered by tests.
