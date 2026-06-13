# CLAUDE.md

Read **[AGENTS.md](./AGENTS.md)** first — it's the single source of guidance for this repo: architecture, layout, tech stack, commands, conventions, release flow, and gotchas.

Claude Code specifics:

- This repo **is** a Figma MCP server. The project-scoped `.mcp.json` launches the local build (`packages/mcp/dist/index.mjs`), so after changing `packages/mcp` or `packages/shared` you must `pnpm build` and restart the MCP connection before the `figwright` tools reflect your change.
- A pre-commit hook formats and lints staged files automatically — don't hand-format.
- The canonical checks before pushing are `pnpm typecheck && pnpm lint && pnpm format:check && pnpm knip && pnpm build && pnpm test` (the same gates CI runs).
