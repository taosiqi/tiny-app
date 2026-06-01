# Validation Matrix

Run focused tests while editing, then run the applicable release checks.

| Area | Required checks |
| --- | --- |
| UI or settings | `pnpm lint`, `pnpm test:frontend`, `pnpm test:e2e`, `pnpm test:build` |
| Rust compression | `pnpm test:rust`, `pnpm test:smoke`, `cargo fmt --check` |
| Shared components | `pnpm test:frontend`, visual inspection in light and dark mode |
| Packaging or FFmpeg | `pnpm prepare:ffmpeg`, `pnpm test:build`, Linux `pnpm test:desktop:e2e` |
| Any tracked changes | `git diff --check`, convention audit |

Run Linux desktop E2E in CI or a prepared Linux environment with `tauri-driver`, WebKitWebDriver, and `xvfb`. Do not report it as passed from macOS.
