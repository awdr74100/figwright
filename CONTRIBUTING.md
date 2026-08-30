# Contributing to Figwright

Thanks for your interest in Figwright! Contributions of all kinds are welcome: bug reports, fixes, new tools, docs, and ideas.

This guide covers the **contribution process**. For the **technical deep-dive** (architecture, the monorepo layout, the tech stack, and gotchas) read **[AGENTS.md](./AGENTS.md)**, which is the canonical guide for working in this repo.

By participating you agree to uphold our [Code of Conduct](./CODE_OF_CONDUCT.md): keep interactions respectful and constructive, so Figwright stays a welcoming project for everyone.

## Ways to contribute

- **Report a bug**: open an [issue](https://github.com/awdr74100/figwright/issues) with steps to reproduce, what you expected, and what happened. Include your MCP client, OS, and Figwright/Node versions.
- **Request a feature**: open an issue describing the problem you're trying to solve, not just the solution. Figwright is **provider-first** and aims for **generality**, so proposals that make a wide range of real designs work better are prioritized over narrow, one-off additions.
- **Send a pull request**: for anything non-trivial, please open an issue first so we can agree on the approach before you invest time.

## Prerequisites

- **Node.js 24 LTS or newer** (see [`.node-version`](./.node-version)).
- **pnpm 11**: this is a pnpm workspace; the version is pinned via `packageManager` in the root `package.json`, so [Corepack](https://nodejs.org/api/corepack.html) uses it automatically.

## Getting started

```bash
git clone https://github.com/awdr74100/figwright.git
cd figwright
pnpm install
pnpm build
```

To run your local build end-to-end, point your MCP client at the built server and import the plugin from `packages/plugin`; see the [Setup](./README.md#setup) in the README. After changing `packages/mcp` or `packages/shared`, **rebuild and restart the MCP server**: it runs the built `dist`, not source.

## Development workflow

The canonical checks (the same gates CI enforces on every push and PR) run from the repo root:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm knip && pnpm build && pnpm test
```

A few things worth knowing (full details in [AGENTS.md](./AGENTS.md)):

- **`pnpm test` from the root is canonical.** It picks up both `packages/*/test/**` and the cross-package suite in the root `test/`. Don't run tests per-package; you'll miss the integration tests.
- **No git hooks.** Formatting and lint are enforced by CI, so run `pnpm format` before committing (or format on save).
- **Tests live in `test/`**, mirroring `src/`, with no co-located tests. Cross-package tests go in the root `test/`.
- Add or update tests for any behavior change.

## Commit & PR conventions

- **[Conventional Commits](https://www.conventionalcommits.org/)**: `type(scope): subject`. The version bump and the changelog are derived from these.
- **PR titles are validated** (`semantic-pr.yml`) and must follow the same format. PRs are **squash-merged** and the PR title becomes the commit on `main`, so write it carefully.
- **Branch off `main`**, keep PRs focused, and make sure CI is green before requesting review.

### Type

`feat` `fix` `perf` `refactor` `docs` `test` `ci` `build` `chore` `style`.

There is deliberately no `revert` type. The Conventional Commits spec does not
define revert behaviour ("we leave it to tooling authors"), and changelogen has no
`revert` type — a commit typed that way would be dropped from the changelog in
silence. **Type a revert by its effect**: `fix(relay): revert the msgpack bin wire
format` lands in Fixes, which is where a reader looks for what changed for them,
and carries the right semver. Note that GitHub's Revert button produces
`Revert "<original title>"`, which has no type, no scope and an uppercase subject,
so the title has to be rewritten by hand regardless.

### Scope (required)

The scope is **not optional and not free-form** — it must be one of nine. The axis is
the capability a reader of the changelog experiences, not the package the diff
lands in: Figwright ships one product, so `mcp` or `shared` would be four fifths
of every release and tell nobody anything.

| Scope       | Covers                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `codegen`   | Figma → code output quality: `get_design_context`, the serializers, breakpoint hints, framework/style profiles                         |
| `design`    | The Figma design surface itself — which node, style and variable properties we can read and write, and the sandbox handlers that do it |
| `grounding` | Reading the local project: `token_map`, `component_map`, `icon_map`, the repo walk, config scanners                                    |
| `tools`     | The MCP tool surface: the registry, input schemas, descriptions, annotations, argument validation, the protocol era                    |
| `relay`     | Everything between the server and the plugin: transport, wire format, election, timeouts, shutdown                                     |
| `plugin`    | The Figma plugin **panel UI** (`packages/plugin/ui`)                                                                                   |
| `skills`    | The bundled `figma-codegen` / `figma-build` skills                                                                                     |
| `deps`      | Dependency bumps (Renovate). Non-breaking `chore(deps)` is filtered out of the changelog by changelogen                                |
| `repo`      | The repository itself: CI, build config, release tooling, editor config, README / CONTRIBUTING / governance docs                       |

Two boundaries that are easy to get wrong:

- **`plugin` is the panel UI only.** A sandbox handler in `packages/plugin/src` is
  scoped by the capability it implements — a font that is not preloaded before a
  text write is `fix(design)`, not `fix(plugin)`, because that is where the reader
  feels it.
- **`docs` is a type, not a scope.** The type already says it is documentation; the
  scope says whose. README and governance docs are `docs(repo)`; a correction to
  the codegen guidance is `docs(codegen)`.

One scope outside the list appears in history and will keep appearing:
`chore(release): vX.Y.Z` is changelogen's own commit template. It is committed
straight to `main` by `pnpm release` and never passes through a PR, so the gate
never sees it.

### When one PR spans several scopes

Scopes can be combined with a comma — `feat(codegen,relay): …` — and changelogen
renders that verbatim as the line's lead-in. But reach for it last, in this order:

1. **Check whether the PR should be two PRs.** A title that resists a single scope
   is usually a PR doing two things. Splitting it is the better fix, and it is the
   one the reader of the changelog benefits from.
2. **Otherwise scope by purpose, not by footprint.** Most wide-reaching changes are
   still one thing to a reader. Adding a text property touches the sandbox handler,
   the Zod mirrors in `shared` and the tool registry — three trees — and is still
   `feat(design)`, because "Figma text gained a property" is the whole of what
   anyone outside the repo experiences. The other two trees are what it cost to
   build, not what it delivered.
3. **Combine only when the reader genuinely gets two things.** If a PR both teaches
   codegen a new CSS property _and_ fixes a transport bug on the way, those are two
   separate wins and `feat(codegen,relay)` is the honest answer.

Three or more scopes is a strong signal for rule 1. As calibration: every one of
the 28 entries in v0.5.0 lands in exactly one scope under this vocabulary.

### Subject

Lowercase first letter, imperative, no trailing period — `subjectPattern` enforces
the casing. changelogen capitalizes it when rendering, so `feat(relay): carry
export bytes as msgpack bin` becomes **relay:** Carry export bytes as msgpack bin.

## Releasing

Releases are handled by maintainers. Versioning and the changelog are driven by Conventional Commits via `changelogen`; see the [Releasing](./AGENTS.md#releasing) section in AGENTS.md for the full flow.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](./LICENSE).
