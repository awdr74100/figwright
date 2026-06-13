# Figwright

Open-source Figma Dev Mode MCP alternative — bridges Claude Code (and other MCP clients) with a Figma plugin over a local WebSocket relay.

> Status: **M0 Foundation**. Not yet usable.

## Why

- **Free** — no Figma paid tier required.
- **Cross-stack** — Vue / React / .NET / Laravel / Django profile-aware codegen.
- **Open** — extend with your own skills.

## Requirements

- Node 24 LTS+
- pnpm 10+

## Development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

### Monorepo layout

```
packages/
  shared/   # types / schemas / msgpack codec / protocol
  mcp/      # MCP server (Node, pure ESM)
  plugin/   # Figma plugin (Vue 3 + Vite + Tailwind v4)
  skills/   # Claude Code skills (markdown)
```

### Running the server locally

```bash
pnpm --filter @figwright/mcp build
pnpm --filter @figwright/mcp link --global
# Then in your MCP client config:
#   command: "npx", args: ["@figwright/mcp@latest"]
```

## License

MIT
