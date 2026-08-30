<!--
Thank you for contributing to Figwright!

Before opening the PR, please make sure:
- The PR title follows Conventional Commits, `type(scope): subject`, with a
  lowercase subject and a scope from the nine in CONTRIBUTING.md (`codegen`,
  `design`, `grounding`, `tools`, `relay`, `plugin`, `skills`, `deps`, `repo`).
  It is validated by CI, and with squash merges it becomes the commit on
  `main` and drives the changelog — write it carefully.
- For anything non-trivial, an issue was opened first to agree on the
  approach (see CONTRIBUTING.md).
-->

## Description

<!--
What is this PR solving, and why? Keep it clear and concise.
Link the issues it resolves, e.g. `Fixes #123`.
-->

## Checklist

- [ ] The canonical checks pass locally: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm knip && pnpm build && pnpm test`
- [ ] Tests are added or updated for any behavior change (in `test/` mirroring `src/`; cross-package tests in the root `test/`)
- [ ] Read-path / serializer changes are verified with a live round-trip against a real Figma file (plugin connected, running the built `dist`)
- [ ] Documentation is updated if needed (README, AGENTS.md, tool descriptions)
