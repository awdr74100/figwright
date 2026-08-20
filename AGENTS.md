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

CI (`.github/workflows/ci.yml`) gates every push and PR on: **typecheck, lint, format:check, knip, build, test**. All must pass. A second job runs **build + test on `windows-latest`** — not the whole gate, because the other four checks are platform-independent and a Windows runner bills at 2×; what actually differs is the filesystem, process spawning and path handling. It exists because Windows is the one platform nobody here can run locally and the only one where a feature is guarded off rather than exercised (see the leader-lock gotcha below), and because two of the traps it guards against were only ever handled blind: `.gitattributes` pins LF so a Windows clone doesn't fail `format:check` on every line, and the repo walk forces `/` separators on every platform.

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
- **A new argument on an existing tool silently changes behaviour for every plugin already installed — and skew warns, it never blocks.** The two halves ship on one version but update through different channels (server via `npx @latest`, plugin as a hand-imported zip), so skew is the default state. Arguments are validated on the server and read positionally by the sandbox handler (`const p = params as { … }`), so an argument an older handler predates is not rejected, it is **dropped**, and the write still answers `{ ok: true }`: a v0.1.0 plugin drops `layoutSizingHorizontal`, so "make this fill its container" reports success and changes nothing. **Refusing the connection was built, measured against a real v0.3.0 plugin, and abandoned** — the plugin decides whether to keep retrying, and every plugin that would be refused is by definition too old to contain that decision, so it re-offered the rejected handshake ~7×/second forever (195 sockets in TIME_WAIT, steady state, from one tab). Everything that softens a refusal lives in the plugin and so only reaches plugins new enough not to need it. What the server can do is kill the _silence_: below `MIN_PLUGIN_VERSION` (`shared/src/version.ts`) every plugin-dispatched tool result gets `pluginSkewNotice` appended telling the agent the result is unverified and the user should update — **failed calls included**, since the loudest thing an old plugin does is answer `METHOD_NOT_FOUND` for a tool it predates (nine of them for v0.3.0) and unattributed that reads as "this tool is broken", and `$hello` carries the same text so a current plugin can show it in its panel (amber — it still works; red is reserved for the wire-format refusal, and the two are told apart by whether the connection is live). `ping` reports each session's `pluginVersion` but not the prose, which would otherwise print twice in one result. A wrong write is still possible; it is no longer unattributable. Rules that are easy to get wrong, each of which was: the threshold applied is **capped at the server's own version** (it is raised in the change that breaks compatibility, always ahead of the release carrying it — uncapped, a dev server would flag the dev plugin built beside it), an **unparseable** version counts as skewed rather than fine, and the notice must reach **followers** too — only the leader holds the relay, so it rides back on the RPC response. It is captured per tool call (async-local, not a module global: a "last notice seen" left the _first_ call after startup unwarned) and attributed to the session that answered that call as it is answered (not re-read afterwards, which with two files open on different builds can name the wrong plugin). One call may reach several plugins; if any is out of date the whole result is unverified, so a later clean report never clears an earlier warning. And **do not filter on `ToolKind`** — `local` marks a tool whose _handler_ runs on the server, not one that skips Figma, and eight of the ten so labelled dispatch (`component_map`, `token_map`, `icon_map`, `design_diff`, the export and save tools); gating on it silenced the warning on exactly the grounding results an agent builds code from. A non-null notice already proves the call dispatched, so no other condition is needed. `PROTOCOL_VERSION` is the separate, still-hard gate: wire format we cannot parse at all. `test/plugin-contract.test.ts` keeps the threshold honest — it records the argument surface of every plugin-dispatched tool (including the `forVision` / `budget` arguments the server injects, which appear in no schema) and fails when it changes, naming which class the change falls into. It cannot decide whether a change is compatible; it makes the decision impossible to skip, which is the part `PROTOCOL_VERSION` never had.
- **A leader that is alive, still holding the port and no longer answering is the one failure the election cannot resolve by waiting — and it is diagnosed from a note the leader leaves, never guessed.** Every other way a leader ends releases :3055, so a follower's next tick binds it and nothing needs explaining. A _suspended_ one (Ctrl-Z on a hand-launched server, `kill -STOP`, a stopped debugger) deadlocks the two halves of the election by construction: "the leader is dead" is decided by a failed `/ping`, but taking over needs the port actually released. Measured before this was closed: the follower retried in silence for the tool's whole budget (88s for a default tool, ~6.5 min for a heavy one) and then reported a bare timeout, a newly opened plugin could not connect to anyone, and only a manual kill recovered. Now `election.ts` counts **consecutive** ticks that find the leader silent _and_ the port still bound (`WEDGED_UNRESPONSIVE_TICKS`, 5 ≈ 12s — one such tick is the ordinary handoff race, and the count resets the moment the leader answers), then enters the existing `Conflicted` state, which already fails `dispatch` fast and keeps contending so recovery is automatic. Two rules that carry the design: **the pid is proved, not read.** `election/leader-lock.ts` writes `{pid, port, buildId, serverVersion, processStartedAt}` to `$TMPDIR/figwright/leader-<port>.json` when a node binds, and a reader re-derives identity from the live process table (`ps -o state=,lstart=`, hence a 2s tolerance — `ps` reports whole seconds) before naming anything; a recycled pid cannot survive that check, and anything that doesn't line up degrades to the anonymous message rather than telling the user to kill an innocent (plausibly a _healthy_ Figwright server). The lock is deliberately never deleted — the next leader overwrites it, and deleting on demotion would race the challenger's own write. **And the verdict has to reach the call already in flight**, not only the next one: `dispatch` subscribes to the role change and aborts the follower's in-flight `/rpc` (`Follower.sendRpc`'s `abort`, `AbortSignal.any`'d with the budget), which is what took the first call after a wedge from 123s to ~12s. Recovery is attempted before giving up — a holder whose state is `T` is sent **`SIGCONT`** (a no-op on a running process, verified; killing stays the user's call and the message names the exact command), which auto-heals the Ctrl-Z case end to end. `test/e2e/process-lifecycle.test.ts` is the gate: it SIGSTOPs a real `dist` leader and asserts the follower names that pid, wakes it, and goes back to following it — the one shape no fake can stand in for, since the diagnosis reads the real process table and the recovery sends a real signal. **Windows gets the half that is pure logic and none of the half that isn't**: the tick's consecutive-silence count and `dispatch`'s fail-fast are platform-independent and work there, while identification and SIGCONT are guarded off (no `ps`, and nothing to be suspended by), so a holder is never named and the anonymous message is all it ever shows — which is why that message's shell hint is picked per platform (`netstat -ano | findstr` rather than `lsof`). That branch is forced in `leader-lock.test.ts` by stubbing `process.platform`, since CI is Linux-only and nothing here can run on Windows.
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
