# Contributing to Figwright

Thanks for your interest in Figwright! Contributions of all kinds are welcome — bug reports, fixes, new tools, docs, and ideas.

This guide covers the **contribution process**. For the **technical deep-dive** — architecture, the monorepo layout, the tech stack, and gotchas — read **[AGENTS.md](./AGENTS.md)**, which is the canonical guide for working in this repo.

By participating, please keep interactions respectful and constructive. We want Figwright to be a welcoming project for everyone.

## Ways to contribute

- **Report a bug** — open an [issue](https://github.com/awdr74100/figwright/issues) with steps to reproduce, what you expected, and what happened. Include your MCP client, OS, and Figwright/Node versions.
- **Request a feature** — open an issue describing the problem you're trying to solve, not just the solution. Figwright is **provider-first** and aims for **generality** — proposals that make a wide range of real designs work better are prioritized over narrow, one-off additions.
- **Send a pull request** — for anything non-trivial, please open an issue first so we can agree on the approach before you invest time.

## Prerequisites

- **Node.js 24 LTS or newer** (see [`.node-version`](./.node-version)).
- **pnpm 11** — this is a pnpm workspace; the version is pinned via `packageManager` in the root `package.json`, so [Corepack](https://nodejs.org/api/corepack.html) uses it automatically.

## Getting started

```bash
git clone https://github.com/awdr74100/figwright.git
cd figwright
pnpm install
pnpm build
```

To run your local build end-to-end, point your MCP client at the built server and import the plugin from `packages/plugin` — see the [Quick start](./README.md#quick-start) in the README. After changing `packages/mcp` or `packages/shared`, **rebuild and restart the MCP server**: it runs the built `dist`, not source.

## Development workflow

The canonical checks — the same gates CI enforces on every push and PR — run from the repo root:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm knip && pnpm build && pnpm test
```

A few things worth knowing (full details in [AGENTS.md](./AGENTS.md)):

- **`pnpm test` from the root is canonical.** It picks up both `packages/*/test/**` and the cross-package suite in the root `test/`. Don't run tests per-package — you'll miss the integration tests.
- **No git hooks.** Formatting and lint are enforced by CI, so run `pnpm format` before committing (or format on save).
- **Tests live in `test/`**, mirroring `src/` — no co-located tests. Cross-package tests go in the root `test/`.
- Add or update tests for any behavior change.

## Commit & PR conventions

- **[Conventional Commits](https://www.conventionalcommits.org/)** — prefix messages with `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `ci:`, etc. The version bump and changelog are derived from these.
- **PR titles are validated** (`semantic-pr.yml`) and must follow the same format. PRs are **squash-merged**, so the PR title becomes the commit on `main` — write it carefully.
- **Branch off `main`**, keep PRs focused, and make sure CI is green before requesting review.

## Releasing

Releases are handled by maintainers. Versioning and the changelog are driven by Conventional Commits via `changelogen`; see the [Releasing](./AGENTS.md#releasing) section in AGENTS.md for the full flow.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](./LICENSE).
