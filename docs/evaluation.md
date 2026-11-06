# Evaluation notes

## What was checked

The native adapter was exercised in a live DSH 0.2.2-rc.1 session on macOS arm64 with ast-index 3.56.0. Definitions/source bodies were found in real Rust and TypeScript code, topic exploration found relevant approval code, truncation was visible and an out-of-workspace project was rejected. Runtime API and lifecycle behavior were reviewed separately.

The portable test suite includes real TypeScript/Python CLI fixtures and mocked DSH services. Mocked sandbox policy propagation is not a substitute for a full end-to-end OS sandbox test on every platform. The plugin inventory SVG/locale resources were validated; visual GUI rendering was not verified through browser automation.

## Context/token experiment

A local deterministic retrieval replay used six Rust/TypeScript tasks. Counts used `js-tiktoken 1.0.21 / o200k_base`, a reference tokenizer rather than the active provider's exact billing. AST counts included rendered output + JSON call arguments. Baselines counted output only, deliberately omitting their call arguments and existing schemas. The common system prompt, model reasoning/final answer, history re-billing and provider cache behavior were excluded.

The six AST calls totalled **1905** reference tokens, plus **248** for the tool schema if counted once. A broad grep/large-read baseline totalled **22428**, dominated by one 2000-line read replaced with an outline. A precise grep/known-window baseline totalled **1374**, cheaper than AST. Excluding the outline, broad baseline **2256** versus AST + one schema **1290** gave a 42.8% reduction, but counting a fresh schema per task removed that advantage.

These are small, selected navigation tasks, **not** an end-to-end autonomous-agent trial, full recall measurement or billing guarantee. The precise baseline sometimes had the correct file and body boundaries in advance; its information content is not identical to AST outline/reference results. Expected evidence was checked, but complete reference resolution was not established.

The original raw experiment contained absolute workspace paths and excerpts from a separate local project. Those logs and project files are deliberately **not published** here. The numbers are historical context, not independently reproducible from this repository alone. The portable fixture suite is included so correctness can be checked without publishing that local workspace. No unsupported 40–50% universal savings claim is made.

## Bun vs Node

Local runtime comparison: Bun **1.4.4**, Node **26.7.0**, one warmup pair excluded, five sequential measured runs of each runtime, alternating order, warm filesystem cache. Test cases and exact rendered AST outputs/token counts matched.

| Median | Node | Bun |
|---|---:|---:|
| Full test suite, including real CLI | 1234 ms | 1179 ms |
| Full development retrieval benchmark | 3315 ms | 3106 ms |

The complete benchmark includes JS startup/tokenizer work, baselines, seven CLI requests including a negative control and JSON writing. It is **not** production query latency. Individual rebuild+query medians varied in both directions: Rust was 1.8–4% slower under Bun, TypeScript 0.3–3.6% faster. That does not establish a stable search-speed improvement. Token output was identical: **additional model-token saving from Bun = 0**.

Bun is the default development runner because it was compatible and modestly faster for that workload. The DSH Host runtime was not migrated. Results should be remeasured on another host/corpus.

## Known correctness/performance limits

- The upstream incremental detector compares second-resolution mtime and size; full rebuild avoids that particular collision but costs time.
- Rebuild and later body reads are not an atomic filesystem snapshot.
- Upstream can report failed subprojects with exit code 0; the adapter checks that diagnostic, but does not certify every skipped/unsupported source file.
- References and implementations are candidates, not a complete language-server/compiler resolver.
- Literal/comment searches and well-scoped text queries can be cheaper with grep.
- Some upstream scanners/config roots are outside the primary file-count cap/read scope. Use trusted projects and bounded roots.

The upstream engine and original authorship are documented in [third-party notices](<../THIRD_PARTY_NOTICES.md>).
