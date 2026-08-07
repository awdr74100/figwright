# AGENTS.md

Figwright is an open-source, **bidirectional** Figma agent for MCP clients (Claude Code and others). It connects an MCP server to a Figma plugin over a local WebSocket relay, letting an AI agent both **read** designs with high-fidelity grounding and **write** back to the canvas — no Figma paid tier required.

This file is the canonical guide for AI agents and contributors working in this repo. (`CLAUDE.md` points here.)

## Architecture

Two halves talk over a local WebSocket relay:

- **MCP server** (`packages/mcp`, published as `@figwright/mcp`) — the Node process an MCP client launches. It exposes 112 tools — reads, writes, and higher-level **grounding** tools that join Figma data with the user's codebase (component / token / icon maps) — plus a codegen prompt. It owns the relay, leader/follower **election** (multiple MCP servers can share one plugin; **newest build wins** — a leader on an older build abdicates to a newer one at the next idle moment), and request **idempotency**.
- **Figma plugin** (`packages/plugin`) — a Vue 3 + Vite UI plus a sandbox that runs inside Figma and performs the actual Figma API calls. It connects out to the server's WebSocket.
- **Shared** (`packages/shared`) — types, Zod schemas, the msgpack wire codec, and the plugin↔server protocol. It is **bundled into the server at build time** (not published on its own).

Design stance: **provider-first**. Rather than a fixed compiler pipeline, the tools surface faithful, de-duplicated design context and let the LLM generate code that matches the user's actual stack (detected framework / styling system). The `figma-codegen` skill and the MCP `figma_to_code` prompt encode this approach.

## Layout

```
packages/
  shared/   # types, Zod schemas, msgpack codec, plugin↔server protocol (bundled into mcp)
  mcp/      # the MCP server — @figwright/mcp (Node, ESM): relay, election, tools, joins
  plugin/   # Figma plugin — Vue 3 + Vite + Tailwind v4 (UI) + sandbox (Figma API)
skills/     # agent skills that orchestrate the tools (figma-codegen, figma-build) — installable via `npx skills add`
test/       # cross-package integration tests (e.g. server tool registry ↔ plugin handlers)
```

`packages/mcp/src` is organized by concern: `tools/`, `relay/`, `election/`, `join/` (component/token/icon maps), `tokens/`, `profile/` (stack detection), `scan/`, `icons/`, `diff/` (design_diff baselines), `prompts/`.

`packages/plugin` has three top-level source trees, one per execution context: `ui/` is the Vue panel (`components/` — flat, prefixed `Panel*` for the window's chrome, `Tab*` for a tab's contents, `Ui*` for reusable primitives — plus `composables/`, `relay/` for the socket and session state, and `sandbox/` for the iframe↔sandbox channel); `src/` is the Figma-API sandbox (`handlers/`, one per tool, plus `panel.ts` for the window itself); and `protocol/` holds the panel-control contract **both** ends import, kept out of `shared` so the window's geometry never ships to the server.

## Tech stack

- **Node 24** (see `.node-version`), **pnpm 11** workspace (pinned via `packageManager`), ESM throughout.
- **TypeScript** (strict). Build: **tsdown** (the server bundles `shared`); the plugin builds with **Vite** (single-file UI).
- **Vitest** (tests), **oxlint** (lint), **oxfmt** (format), **knip** (unused deps/exports/files).
- **Zod** for server tool I/O + shared schemas; **msgpack** on the wire.

## Commands

Run from the repo root:

```bash
pnpm install     # install workspace deps
pnpm typecheck   # tsc across packages
pnpm lint        # oxlint
pnpm format      # oxfmt (write); `pnpm format:check` is the CI variant
pnpm knip        # unused deps / exports / files
pnpm build       # build all packages (tsdown + vite)
pnpm test        # vitest run — the canonical test command
```

`pnpm test` from the root is **canonical** — it picks up both `packages/*/test/**` and the root `test/**`. Don't run tests per-package; you'll miss the cross-package suite.

CI (`.github/workflows/ci.yml`) gates every push and PR on: **typecheck, lint, format:check, knip, build, test**. All must pass.

## Engineering standard

Figwright's moat is **grounding fidelity and generality** — how accurately and how broadly real designs turn into correct code (reliability is the floor, not the differentiator). Hold that bar by default; it is the point of the project, not a mode to switch on when asked.

- **Equal-or-better, never a regression.** Any change to existing behaviour must leave every real design's output the same or better. Before claiming a change is good, find the case where it could be _worse_ — adversarially stress-test your own proposal against diverse real designs (mixed-style text, wrapping layouts, absolute / constraint positioning, deep component trees), and drop or fix anything that can't clear the bar. Verify, then assert.
- **Fix root causes, not symptoms.** Read the implementation, the schemas, and the serializer; hunt the systemic class of bug — the recurring one here is _a multi-dimensional Figma property collapsed to a single field, or dropped on the way out_. Don't infer from the rendered screenshot.
- **Don't gold-plate.** Spend effort where it moves fidelity / generality; resist over-engineering for a "killer feature" narrative. The smallest change that faithfully closes the gap wins.
- **Prove it on real designs.** Pair unit tests with a live round-trip against an actual Figma file (plugin connected) — especially for read-path / serializer changes, where the running server uses the built `dist` (see Gotchas).

## Conventions

- **Commits / PRs**: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `refactor:`, `ci:`, …). PR titles are validated by `semantic-pr.yml`; with squash merges the PR title becomes the commit on `main`.
- **Tests**: each package has a `test/` mirroring `src/` (no co-located tests). Tests that span packages live in the root `test/`.
- **Formatting & lint** are enforced by CI (`format:check`, `lint`) — there are no git hooks. Run `pnpm format` before committing, or let your editor format on save.
- **Scope**: internal packages are `@figwright/*`; only `@figwright/mcp` is published to npm.

## Gotchas — read before changing `mcp` or `shared`

- **The MCP server runs the BUILT `dist`, not source.** After changing anything in `packages/mcp` or `packages/shared`, run `pnpm build` and restart the MCP server — otherwise you're testing stale code.
- **The MCP SDK is a runtime dependency, so `tsc` is not a gate for it.** `@modelcontextprotocol/server` (v2) generates every tool's advertised JSON Schema and negotiates the protocol version at runtime; an SDK release can change what clients see while typecheck stays green. `packages/mcp/test/e2e/mcp-wire.test.ts` is the gate — it spawns the built `dist` over real stdio and asserts the advertised contract. Like the other `dist`-backed e2e tests it **skips** when `dist` is missing, so a local `pnpm test` without a build silently proves nothing; CI always builds first.
- **`@figwright/shared` is a devDependency and is bundled** into the server (tsdown `alwaysBundle`). Never move it to runtime `dependencies`, or `npm i @figwright/mcp` would try to fetch an unpublishable workspace package.
- **Single-product versioning**: one version lives on `@figwright/mcp`. Root / shared / plugin are private and intentionally **not** version-synced — the git tag `vX.Y.Z` is the one product version.
- **A new argument on an existing tool silently changes behaviour for every plugin already installed — and skew warns, it never blocks.** The two halves ship on one version but update through different channels (server via `npx @latest`, plugin as a hand-imported zip), so skew is the default state. Arguments are validated on the server and read positionally by the sandbox handler (`const p = params as { … }`), so an argument an older handler predates is not rejected, it is **dropped**, and the write still answers `{ ok: true }`: a v0.1.0 plugin drops `layoutSizingHorizontal`, so "make this fill its container" reports success and changes nothing. **Refusing the connection was built, measured against a real v0.3.0 plugin, and abandoned** — the plugin decides whether to keep retrying, and every plugin that would be refused is by definition too old to contain that decision, so it re-offered the rejected handshake ~7×/second forever (195 sockets in TIME_WAIT, steady state, from one tab). Everything that softens a refusal lives in the plugin and so only reaches plugins new enough not to need it. What the server can do is kill the _silence_: below `MIN_PLUGIN_VERSION` (`shared/src/version.ts`) every plugin-dispatched tool result gets `pluginSkewNotice` appended telling the agent the result is unverified and the user should update, `$hello` carries the same text so a current plugin can show it in its panel, and `ping` reports it as `pluginSkew`. A wrong write is still possible; it is no longer unattributable. Three rules that are easy to get wrong: the threshold applied is **capped at the server's own version** (it is raised in the change that breaks compatibility, always ahead of the release carrying it — uncapped, a dev server would flag the dev plugin built beside it), an **unparseable** version counts as skewed rather than fine, and the notice must reach **followers** too — only the leader holds the relay, so it rides back on the RPC response. `PROTOCOL_VERSION` is the separate, still-hard gate: wire format we cannot parse at all. `test/plugin-contract.test.ts` keeps the threshold honest — it records the argument surface of every plugin-dispatched tool (including the `forVision` / `budget` arguments the server injects, which appear in no schema) and fails when it changes, naming which class the change falls into. It cannot decide whether a change is compatible; it makes the decision impossible to skip, which is the part `PROTOCOL_VERSION` never had.
- **The manifest claims three editors; the plugin API only backs one of them fully.** `editorType` lists `figma`, `figjam` and `dev`, but Dev Mode rejects every write (nodes, pages, variables, styles alike) and FigJam has no components / variables / styles / Motion — though it _does_ have frames, sections, shapes and text. Nothing in the type system says so: `figma.createPaintStyle()` compiles everywhere and is `not a function` in FigJam. `protocol/editor-context.ts` holds that table and appends the editor's limitation to handler errors; it carries **no list of which tools write**, on purpose, since only the calls an editor rejects ever reach that path. Both sentences in that table were wrong until checked against the real editors — if you add an editor to `editorType`, add its row there **and verify it live**, because no gate in this repo can.

## Releasing

Versioning and changelog are driven by Conventional Commits via **changelogen**, behind `scripts/release.mjs`:

```bash
pnpm release            # pick the version from a menu, then bump @figwright/mcp,
                        # write the root CHANGELOG.md, commit + tag vX.Y.Z, and
                        # offer to push (the push triggers release.yml)
```

The menu exists because **changelogen demotes every bump while the version is `0.x`** — its `bumpVersion()` turns major into minor _and_ minor into patch, so a release full of features lands on `0.3.1` and even `changelogen --release --minor` does. An explicit `-r <version>` is the only way to override that before 1.0, which is what the script passes. It re-infers the bump from the same commit set changelogen would changelog, keeps the half of the pre-1.0 rule that is actually conventional (breaking → minor, since 0.x promises no stability), and offers that as the default; `1.0.0` stays in the menu but has to be chosen. It refuses to run on a dirty tree — changelogen only stages `CHANGELOG.md` and `packages/mcp/package.json`, so the tag would otherwise point at a commit missing whatever else is in flight — and on a tag that already exists. There is **no flag or argument that picks the version for you** — cutting a release is meant to be a hands-on act, so the script takes no arguments and refuses to run without a tty rather than falling back to a guess.

The **push is a separate prompt that defaults to no**, because it is the irreversible half: the tag landing on GitHub starts `release.yml`, and npm refuses to reuse a version even after an unpublish. Until you answer it the tag is local, so a wrong version is still `git tag -d` + `git reset --hard HEAD~1` away (the script prints exactly that on decline). Answering yes runs `git push --follow-tags` with an inherited tty, so git can still prompt for your SSH passphrase; if the push fails the tag stays local and the retry command is printed.

The release workflow builds and tests, publishes `@figwright/mcp` to npm (OIDC trusted publishing + provenance), creates the GitHub Release from the changelog, and attaches the Figma plugin as a downloadable zip (manifest + built `dist`) for manual import in Figma dev mode.
