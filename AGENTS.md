# AGENTS.md

Figwright is an open-source, **bidirectional** Figma agent for MCP clients (Claude Code and others). It connects an MCP server to a Figma plugin over a local WebSocket relay, letting an AI agent both **read** designs with high-fidelity grounding and **write** back to the canvas — no Figma paid tier required.

This file is the canonical guide for AI agents and contributors working in this repo. (`CLAUDE.md` points here.)

## Architecture

Two halves talk over a local WebSocket relay:

- **MCP server** (`packages/mcp`, published as `@figwright/mcp`) — the Node process an MCP client launches. It exposes 80+ read/write tools, plus higher-level **grounding** tools that join Figma data with the user's codebase (component / token / icon maps) and a codegen prompt. It owns the relay, leader/follower **election** (multiple MCP servers can share one plugin), and request **idempotency**.
- **Figma plugin** (`packages/plugin`) — a Vue 3 + Vite UI plus a sandbox that runs inside Figma and performs the actual Figma API calls. It connects out to the server's WebSocket.
- **Shared** (`packages/shared`) — types, Zod schemas, the msgpack wire codec, and the plugin↔server protocol. It is **bundled into the server at build time** (not published on its own).

Design stance: **provider-first**. Rather than a fixed compiler pipeline, the tools surface faithful, de-duplicated design context and let the LLM generate code that matches the user's actual stack (detected framework / styling system). The `figma-codegen` skill and the MCP `figma_to_code` prompt encode this approach.

## Layout

```
packages/
  shared/   # types, Zod schemas, msgpack codec, plugin↔server protocol (bundled into mcp)
  mcp/      # the MCP server — @figwright/mcp (Node, ESM): relay, election, tools, joins
  plugin/   # Figma plugin — Vue 3 + Vite + Tailwind v4 (UI) + sandbox (Figma API)
  skills/   # Claude Code skills that orchestrate the tools (figma-codegen)
test/       # cross-package integration tests (e.g. server tool registry ↔ plugin handlers)
```

`packages/mcp/src` is organized by concern: `tools/`, `relay/`, `election/`, `join/` (component/token/icon maps), `tokens/`, `profile/` (stack detection), `scan/`, `icons/`, `prompts/`.

## Tech stack

- **Node 24** (see `.node-version`), **pnpm 10** workspace, ESM throughout.
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

## Conventions

- **Commits / PRs**: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `refactor:`, `ci:`, …). PR titles are validated by `semantic-pr.yml`; with squash merges the PR title becomes the commit on `main`.
- **Tests**: each package has a `test/` mirroring `src/` (no co-located tests). Tests that span packages live in the root `test/`.
- **Formatting & lint** are enforced by CI (`format:check`, `lint`) — there are no git hooks. Run `pnpm format` before committing, or let your editor format on save.
- **Scope**: internal packages are `@figwright/*`; only `@figwright/mcp` is published to npm.

## Gotchas — read before changing `mcp` or `shared`

- **The MCP server runs the BUILT `dist`, not source.** After changing anything in `packages/mcp` or `packages/shared`, run `pnpm build` and restart the MCP server — otherwise you're testing stale code.
- **`@figwright/shared` is a devDependency and is bundled** into the server (tsdown `alwaysBundle`). Never move it to runtime `dependencies`, or `npm i @figwright/mcp` would try to fetch an unpublishable workspace package.
- **Single-product versioning**: one version lives on `@figwright/mcp`. Root / shared / plugin are private and intentionally **not** version-synced — the git tag `vX.Y.Z` is the one product version.

## Releasing

Versioning and changelog are driven by Conventional Commits via **changelogen**:

```bash
pnpm release            # bump @figwright/mcp, write the root CHANGELOG.md, commit + tag vX.Y.Z
git push --follow-tags  # the tag triggers .github/workflows/release.yml
```

The release workflow builds and tests, publishes `@figwright/mcp` to npm (OIDC trusted publishing + provenance), creates the GitHub Release from the changelog, and attaches the Figma plugin as a downloadable zip (manifest + built `dist`) for manual import in Figma dev mode.
