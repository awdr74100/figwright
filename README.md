<div align="center">

# Figwright

**Open-source, bidirectional Figma agent for MCP clients.**
A free alternative to Figma's Dev Mode MCP — your AI agent reads designs with high-fidelity grounding _and_ writes back to the canvas. No paid Figma seat required.

_Where Playwright drives the browser, Figwright drives Figma._

[![npm](https://img.shields.io/npm/v/@figwright/mcp?logo=npm&color=cb3837)](https://www.npmjs.com/package/@figwright/mcp)
[![CI](https://github.com/awdr74100/figwright/actions/workflows/ci.yml/badge.svg)](https://github.com/awdr74100/figwright/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/node/v/@figwright/mcp?logo=node.js)](https://nodejs.org)

</div>

<!-- TODO(demo): drop a short GIF / screenshot of a real codegen → canvas round-trip here. -->

## What is Figwright?

Figwright connects an **MCP server** to a **Figma plugin** over a local WebSocket relay, so an AI agent — Claude Code, Cursor, or any other MCP client — can work _with_ Figma instead of just looking at it.

It works in both directions:

- **Read** — turn a Figma selection into framework-aware code, grounded on faithful, de-duplicated design context (layout, typography, variables, components).
- **Write** — author and edit the canvas directly: frames, text, auto-layout, styles, variables, components, whole screens.

Everything runs on your machine and talks to Figma through a plugin, so it needs **no Figma Dev Mode seat** and **no paid tier**.

## Why Figwright

- **Free** — no Figma Dev Mode or paid seat. The official Dev Mode MCP is gated; Figwright isn't.
- **Bidirectional** — not read-only. **88 tools** span reading _and_ writing the canvas, so an agent can both implement designs and build them.
- **Provider-first codegen** — Figwright detects your real stack (framework + styling system) and reuses your existing components, tokens, and icons, instead of emitting generic markup you have to rewrite.
- **Any MCP client** — Claude Code, Cursor, and other MCP-capable agents all work the same way.
- **Open & extensible** — the read/write workflows ship as installable [skills](#skills) you can adopt or fork.

## How it works

Your MCP client talks to the `@figwright/mcp` server over stdio; the server relays to the Figma plugin over a local WebSocket. Several clients can share one plugin — they elect a leader that owns the connection — and the transport is built to ride out dropped sockets:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ MCP CLIENTS  —  one per agent                                       │
│ Claude Code · Cursor · Claude · any MCP-capable client              │
└─────────────────────────────────────────────────────────────────────┘
                                   │  MCP protocol over stdio
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ @figwright/mcp  —  your client launches one; they elect a leader    │
│                                                                     │
│ LEADER   (owns the single plugin connection)                        │
│    • WebSocket relay · request idempotency                          │
│    • routes to the most-recently-active file                        │
│    • session resume · "busy ≠ dead" heartbeat                       │
│    • endpoints:  /ws (plugin) · /ping (health) · /rpc (followers)   │
│                                                                     │
│ FOLLOWERS                                                           │
│    • forward tool calls to the leader over HTTP /rpc                │
│    • take over automatically if the leader exits                    │
└─────────────────────────────────────────────────────────────────────┘
                                   │  local WebSocket · msgpack (binary)
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ FIGMA  (desktop or browser)                                         │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Figwright plugin                                                │ │
│ │   • UI (Vue 3 iframe): WebSocket client + heartbeat             │ │
│ │   • sandbox: executes Figma Plugin API calls                    │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│              │ Figma Plugin API                                     │
│              ▼                                                      │
│            Canvas                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

By design Figwright is **provider-first**: rather than a fixed compiler pipeline, the tools surface honest design context and let the model generate code that matches _your_ codebase. The [`figma-codegen`](#skills) skill encodes this approach.

## Quick start

### 1. Add the server to your MCP client

For Claude Code, add this to your `.mcp.json` (other clients use the same shape):

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

`npx` fetches and runs the published server — no global install needed.

### 2. Install the Figma plugin

The plugin isn't on the Figma Community marketplace yet, so install it from the latest release:

1. Download the plugin zip from the [**latest GitHub Release**](https://github.com/awdr74100/figwright/releases/latest) and unzip it.
2. In the Figma **desktop app**: **Menu → Plugins → Development → Import plugin from manifest…** and pick the unzipped `manifest.json`.

### 3. Connect

Open the Figwright plugin in Figma (**Plugins → Development → Figwright**). It connects to the local server automatically and shows **Connected**. Ask your agent to run `ping` to confirm the link.

### 4. (Optional) Install the skills

The [skills](#skills) make agents reach for Figwright at the right moment and follow the grounded workflows:

```bash
npx skills add awdr74100/figwright/skills
```

### 5. Try it

With a frame selected in Figma, prompt your agent:

> _Code this Figma selection as a React component._

or, the other direction:

> _Build a pricing section in Figma from this spec._

## Skills

Agent skills orchestrate Figwright's tools. They're model-invoked — your agent loads one automatically when the task matches its description.

| Skill                                              | What it does                                                                                        |
| :------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| [`figma-codegen`](./skills/figma-codegen/SKILL.md) | Turn a Figma selection into framework-aware code, grounded on your stack and existing components.   |
| [`figma-build`](./skills/figma-build/SKILL.md)     | Build a Figma design from code or a description, reusing the file's existing components and styles. |

Install across any supported agent with the [`skills`](https://www.skills.sh) CLI:

```bash
npx skills add awdr74100/figwright/skills      # both
npx skills add https://github.com/awdr74100/figwright/tree/main/skills/figma-codegen  # one
```

> [!NOTE]
> Skills need the `@figwright/mcp` server connected — on their own they have no tools to drive.

## Tools

Figwright exposes **88 MCP tools** in three groups:

- **Read** — selection, document and node inspection, styles, variables, components, fonts, reactions, screenshots, and PDF export.
- **Write** — create and edit frames, text, shapes, auto-layout, effects, styles, variables, components, pages, and reactions; plus a `batch` tool to apply many edits at once.
- **Grounding** — `get_design_context` for faithful, de-duplicated design context, and `component_map` / `token_map` / `icon_map`, which join Figma data to your codebase so codegen reuses what you already have.

> [!TIP]
> Your MCP client lists every tool at connect time — that's always the authoritative, up-to-date catalog.

## Requirements

- An **MCP client** (Claude Code, Cursor, …).
- **Node.js 24 LTS or newer** — the server runs via `npx`.
- **Figma** — the free tier is enough; the desktop app is needed to import the plugin in development.

## FAQ

<details>
<summary><strong>My MCP client can't start the server — <code>npx</code> or <code>node</code> "command not found".</strong></summary>

This almost always means your MCP client can't find `node` / `npx` on its `PATH` — it isn't specific to Figwright and affects any `npx`-launched MCP server. It's especially common when Node is managed by a version manager (**fnm, nvm, asdf, volta, mise**): those set `PATH` from shell hooks that only run in interactive terminals, so a GUI app or MCP client that spawns the command directly never inherits them.

Fixes, easiest first:

- **Use an absolute path.** In a normal terminal run `which npx` (or `which node`) and use that full path as `command`:

  ```json
  {
    "mcpServers": {
      "figwright": {
        "command": "/Users/you/.local/share/fnm/node-versions/v24.x.x/installation/bin/npx",
        "args": ["-y", "@figwright/mcp@latest"]
      }
    }
  }
  ```

- **Install it and point at the binary.** Install the package (globally with `npm i -g @figwright/mcp`, or as a local dependency), then set `command` to the absolute path from `which figwright-mcp`. As a bonus this skips the network resolution that `npx … @latest` does on every launch.

- **Pass `PATH` through `env`.** If your client supports a per-server `env`, add your version manager's `bin` directory to `env.PATH`.

</details>

<details>
<summary><strong>The plugin stays on "Waiting" and never connects.</strong></summary>

The server is launched by your MCP client, so it only runs while that client is open. Check that:

- your MCP client is running and has Figwright configured (try a `ping`);
- the plugin is open in the **same** Figma app on the same machine (the relay is local-only, `127.0.0.1`);
- nothing is blocking local loopback connections (some firewall / security tools do).

</details>

<details>
<summary><strong>Do I need a paid Figma plan or Dev Mode?</strong></summary>

No. Figwright talks to Figma through a plugin, so the free tier is enough — no Dev Mode seat or paid tier required.

</details>

<details>
<summary><strong>Can more than one agent use the same plugin at once?</strong></summary>

Yes. Several MCP servers can share a single plugin via leader/follower **election** — one leads, the others follow, with a graceful handoff if the leader goes away.

</details>

## Contributing & development

Contributions are welcome — see **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the workflow, and **[AGENTS.md](./AGENTS.md)** for architecture, layout, and conventions.

```
packages/
  shared/   # types, Zod schemas, msgpack codec, plugin↔server protocol (bundled into mcp)
  mcp/      # the MCP server — @figwright/mcp (Node, ESM): relay, election, tools, joins
  plugin/   # Figma plugin — Vue 3 + Vite + Tailwind v4 (UI) + sandbox (Figma API)
skills/     # agent skills that orchestrate the tools — installable via `npx skills add`
```

Run the canonical checks from the repo root (the same gates CI enforces):

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm format:check && pnpm knip && pnpm build && pnpm test
```

## What's in the name

`figwright` follows the **_-wright_** tradition — an old English word for a maker or craftsman: a **playwright** writes plays, a **shipwright** builds ships, a **wheelwright**, wheels. The name is a nod to [**Playwright**](https://playwright.dev), which automates the browser. Where Playwright drives the browser, **Figwright** drives Figma — a maker of designs that both reads the canvas and crafts work back onto it.

## License

[MIT](./LICENSE) © Roya
