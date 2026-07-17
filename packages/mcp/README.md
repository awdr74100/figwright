# @figwright/mcp

> The MCP server for **[Figwright](https://github.com/awdr74100/figwright)** — a two-way Figma agent for Claude Code, Cursor, Codex, and other MCP clients.

Figwright bridges MCP clients to a Figma plugin over a local WebSocket relay, so an AI agent can both **read** your designs with high-fidelity grounding and **write** back to the canvas — no Figma paid tier required. The server exposes **112 tools** spanning reads, writes, and codebase-grounded context.

## Usage

Add it to your MCP client config (e.g. Claude Code's `.mcp.json`):

```json
{
  "mcpServers": {
    "figwright": {
      "command": "npx",
      "args": ["-y", "@figwright/mcp@latest"]
    }
  }
}
```

The server talks to the Figwright Figma plugin running in your Figma app. See the [main repository](https://github.com/awdr74100/figwright) for the full setup (installing the plugin, connecting, and the available skills).

## Requirements

- Node.js 20.19+ or 22.12+ (the server runs via `npx` as its own process, independent of your project's Node version)

## Links

- Repository & docs: https://github.com/awdr74100/figwright
- Issues: https://github.com/awdr74100/figwright/issues

## License

[MIT](https://github.com/awdr74100/figwright/blob/main/LICENSE)
