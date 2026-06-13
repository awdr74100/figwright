# Changelog

## v0.1.0

Initial release. **Figwright** is an open-source, bidirectional Figma agent for MCP clients (Claude Code and others). It bridges an MCP server to a Figma plugin over a local WebSocket relay — no Figma paid tier required.

### Highlights

- **Read with high-fidelity grounding** — pull faithful, de-duplicated design context (layout & auto-layout, styles, variables/tokens, components, effects, gradients) so generated code matches the design.
- **Write back to the canvas** — a broad set of write tools: create and edit nodes, text, styles, variables, auto-layout, components/instances, plus atomic batched edits.
- **Codebase-aware codegen** — joins Figma data to your repo (component / token / icon maps) and detects your stack (framework + styling system); the provider-first `figma_to_code` prompt and `figma-codegen` skill generate code that fits your project.
- **Resilient connection** — local WebSocket relay with multi-plugin routing, leader/follower election (multiple MCP servers can share one plugin), and request idempotency.

### Install

- Server: add `npx @figwright/mcp@latest` to your MCP client config.
- Plugin: download the plugin zip from this release and import the manifest in Figma (Plugins → Development → Import plugin from manifest).
