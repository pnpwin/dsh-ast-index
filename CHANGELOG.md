# Changelog

## 1.0.1 — 2026-11-07

- Move root-level JavaScript sources into `src/`; load the bundle via `src/index.js`.
- Keep existing test, locale, scripts and documentation directories in place.
- Update package exports, archive inventory and tests for the new layout.
- Add a regression check enforcing a source-free repository root.
- No changes to search behavior or the tool schema.

## 1.0.0 — 2026-11-07

- Standalone native DSH/Cordis bundle for defendend's ast-index CLI.
- One bounded `ast_index` tool: definitions, references, outlines and topic exploration.
- Per-call full rebuild, isolated workspace cache, explicit warnings/truncation and fail-closed refresh errors.
- Session sandbox and cancellation propagation; minimal CLI environment.
- Bun-first tests with a Node compatibility command and real TypeScript/Python CLI fixtures.
- Portable PATH-based executable configuration and upstream attribution.
- No CLI binaries, automatic dependency installers, profile-file rewrites, or Claude-specific hooks.
