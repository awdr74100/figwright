# @figwright/mcp

> The MCP server for **[Figwright](https://github.com/awdr74100/figwright)**: a two-way Figma agent for Claude Code, Cursor, Codex, and other MCP clients.

Figwright bridges MCP clients to a Figma plugin over a local WebSocket relay, so an AI agent can both **read** your designs with high-fidelity grounding and **write** back to the canvas. No Figma paid tier required. The server exposes **123 tools** spanning reads, writes, and codebase-grounded context.

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

## Responsive tools

- `configure_responsive_layout` — opt-in width rules for explicit layout, existing GRID tracks,
  whole-node visibility and public INSTANCE BOOLEAN/VARIANT properties. The default `standard`
  thresholds are 0/640/768/1024/1280/1536; users can override them through their AI client. It does
  not add an editor to the plugin panel or infer actions from the preset.
- `get_responsive_layout` — read configuration, effective thresholds and each root's status/error
  without scanning or modifying the design.

Select the intended file with `use_file` and confirm node IDs first. Rules use FRAME width, not
necessarily viewport width, and run only while the plugin is open. Other pages pause. Disable
stops future writes without rollback. Inspect `accepted`, `applied` and root errors; acceptance
alone does not mean all rules were applied. See the [write rules](../../skills/figma-build/references/write-rules.md#opt-in-responsive-rules-configuration-through-ai-not-the-panel)
for configuration examples and protection boundaries.

Accepted configuration, its enabled flag and resolved thresholds are saved in the Figma document.
Enabled rules resume when the plugin reopens on their configured page, without another MCP call.
Call `configure_responsive_layout` separately from `batch`: ongoing control has no faithful inverse.
An apply failure may leave earlier writes in place; inspect root errors and reconfigure explicitly
to retry. Updating only the server does not add these tools to an older plugin; install the matching
plugin build as well.

## Requirements

- Node.js 20.19+ or 22.12+ (the server runs via `npx` as its own process, independent of your project's Node version)

## Links

- Repository & docs: https://github.com/awdr74100/figwright
- Issues: https://github.com/awdr74100/figwright/issues

## License

[MIT](https://github.com/awdr74100/figwright/blob/main/LICENSE)
