# AST index search for DSH

[Русский](<README.ru.md>) · [Upstream ast-index](https://github.com/defendend/Claude-ast-index-search)

A native **DeepSeek Harness / Cordis** bundle for **[ast-index by defendend](https://github.com/defendend/Claude-ast-index-search)**. The Rust CLI does the indexing; this independent adapter exposes one bounded `ast_index` agent tool and respects DSH's session sandbox and cancellation.

**The search engine is the upstream project's work.** This repository supplies the DSH integration, not a replacement CLI or an official upstream/DSH release. See [attribution](<THIRD_PARTY_NOTICES.md>) and the [MIT license](<LICENSE>).

## Requirements

- DSH **0.2.2-rc.1 or compatible 0.2.x**; that version was tested. Future releases are not guaranteed compatible.
- The upstream **ast-index 3.56.0** CLI installed separately and visible to the DSH Host's PATH.
- A POSIX environment with Bash and `env`: **macOS tested**, Linux-compatible code with CI provided; native Windows/PowerShell is not supported by this release.
- Bun **1.4.4** is recommended for development/testing, **not required to load the plugin**. Node **26.7.0** compatibility was also tested.

Install the CLI using [upstream's instructions](https://github.com/defendend/Claude-ast-index-search#installation). For example, with an existing Rust toolchain:

```bash
cargo install ast-index --version 3.56.0 --locked
ast-index --version
```

The adapter never downloads executables or installs dependencies automatically.

## Install in DSH

Clone this repository into a **persistent directory**:

```bash
git clone https://github.com/pnpwin/dsh-ast-index.git
```

Ask your DSH agent:

> Install the DSH bundle from the absolute path to this cloned directory using `plugin_manager install_bundle`, then verify that `ast_index` can find a symbol in my workspace.

For an agent with that tool, the request is:

```json
{"action":"install_bundle","target":"/absolute/path/to/dsh-ast-index"}
```

Use the actual absolute path, not the placeholder. Changes affect the current **profile**, including its other sessions. Local directory installation links the checkout: do not move/delete it while installed. A release tarball is also available in [GitHub Releases](https://github.com/pnpwin/dsh-ast-index/releases); its archive contents are checked before publishing. This package is distributed on GitHub, **not the npm registry**.

If you previously installed a local prototype or another adapter exposing `ast_index`, disable it in DSH Plugins first. Two registrations with the same tool name can conflict. Enable only one adapter.

### CLI path

[The bundle patch](<cordis.patch.yml>) uses `executable: ast-index`, resolved in the DSH execution environment. If Desktop cannot see your terminal's PATH, change this bundle's `executable` to the absolute result of `command -v ast-index` before installation. For an already installed bundle, use DSH's normal plugin configuration/Loader mechanisms; do not let plugin code rewrite the active profile patch.

## Agent tool

```json
{"action":"symbol","query":"PaymentService","content":true}
{"action":"outline","query":"src/payments.ts","project":"my-app"}
{"action":"refs","query":"PaymentService","inFile":"src/","limit":10}
{"action":"explore","query":"payment retry","limit":3}
```

Actions: `search`, `symbol`, `outline`, `refs`, `implementations`, `explore`, `map`, `stats`.

- `project`: root inside the session workspace; defaults to its working directory.
- `limit`: 1–50 matches per section, default 10; explore is capped at 6 files.
- `inFile`: path filter for search/symbol/refs.
- `content`: source bodies for search/symbol; off by default.
- `maxChars`: 500–24000, default 6000, plus a short result header. Truncation is explicit.

Prefer AST navigation for unknown code structure, exact definitions and function boundaries. Use normal grep for literals/comments and precise text searches. Before editing, read the current source through DSH's normal file tools to preserve stale-version protection.

## Safety and limitations

- Whitelisted commands only: no arbitrary shell, raw SQL, installers, watchers or root-management actions.
- Session sandbox policy and cancellation go through DSH services. Read-only mode is rejected because indexing requires cache writes.
- A full foreground rebuild precedes each query. This avoids upstream's second-resolution mtime + size collision, at the cost of CPU/I/O and latency. No stale-result fallback on known failures or reported failed subprojects.
- Isolated `.dsh-ast-index` cache inside the workspace; automatic cache GC is disabled. Add that directory to your project's gitignore if desired; the plugin does not edit gitignore itself.
- CLI environment is restricted; credentials, test hooks and DB/VCS overrides are not forwarded. Rebuild progress is suppressed, but warnings/skipped-file diagnostics remain visible.
- This is **not a read sandbox**. Upstream config roots/includes/package symlinks can cause external trees to be read. Only use trusted projects. The main file cap is not a universal bound on all upstream scanners.
- References are **candidates**, not a compiler-resolved complete call graph. Empty results do not prove that code is absent. Dynamic code, unsupported syntax, ignored/generated/minified files and strings can be missed.
- Rebuild + source reads are not an atomic snapshot during concurrent edits. Retry if files are changing.
- Large repos may hit the 110-second subprocess timeout. Full rebuild can be slower than grep; use a smaller project root when appropriate.
- Bun test support does not change the runtime of an already running DSH Host. `node:*` imports are intentionally portable; no standalone Node/Bun wrapper process is launched per query.

## Source layout

Plugin source files live under `src/`: DSH loads [src/index.js](<src/index.js>) through the package export, and [src/runtime.js](<src/runtime.js>) implements the tool. The root contains documentation, Git metadata, and only the manifest, Loader patch and icon needed for discovery/display. Existing `test/`, `locale/`, `scripts/`, `docs/` and `.github/` directories retain their roles and locations. Tests and archive validation enforce this root-file policy.

## Tests and packaging

No npm dependencies or lifecycle/install scripts are required. Install the CLI first, then:

```bash
bun run test
bun run test:node
bun run pack:check
bun run pack
```

Use `AST_INDEX_BIN=/absolute/path/to/ast-index bun run test` to select another binary. The real-CLI test **fails**, rather than silently skips, when the CLI is unavailable. The suite covers validation, escaping, policy/cancellation propagation, refresh failures, partial rebuild diagnostics, truncation, lifecycle and real TypeScript/Python navigation with same-size/same-mtime edits.

`bun run pack` writes the installable bundle to `dist/`. Pack validation checks the exact archive inventory, imports the extracted runtime, and scans included text for obvious secrets/local-machine paths. That scan is defense in depth, not a security certification. Development/CI scripts and tests are source-checkout tooling; the runtime archive contains only the explicitly listed bundle resources and documentation.

## Performance: no unconditional token-saving claim

Structural slices can reduce context compared with broad grep + large file reads, but a precise grep/read can be cheaper. A small local Node/Bun comparison found identical tool output and token counts; Bun reduced development benchmark wall time by about 6%, not search latency consistently. No billing or universal speedup is promised. See the methodology and caveats in [evaluation notes](<docs/evaluation.md>).

## Remove / update

Disable or remove `@pnpwin/dsh-ast-index` in DSH Plugins. Removing the bundle does not delete the source checkout or workspace cache. Updating an already loaded runtime may require restarting DSH; follow the manager's reported application state.

CLI/parser problems belong in the [upstream repository](https://github.com/defendend/Claude-ast-index-search/issues); adapter problems belong in [this repository](https://github.com/pnpwin/dsh-ast-index/issues).
