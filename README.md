<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/logo-full-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/logo-full-light.svg">
  <img alt="Figwright" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/logo-full-light.svg" width="480" height="240">
</picture>

Where Playwright drives the browser, Figwright drives Figma.

[![npm](https://img.shields.io/npm/v/@figwright/mcp?logo=npm&color=cb3837)](https://www.npmjs.com/package/@figwright/mcp)
[![CI](https://github.com/awdr74100/figwright/actions/workflows/ci.yml/badge.svg)](https://github.com/awdr74100/figwright/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Glama MCP server](https://glama.ai/mcp/servers/awdr74100/figwright/badges/score.svg)](https://glama.ai/mcp/servers/awdr74100/figwright)

</div>

## What is Figwright?

Figwright connects an **MCP server** to a **Figma plugin** over a local WebSocket relay, so an AI agent — Claude Code, Cursor, or any other MCP client — can work _with_ Figma instead of just looking at it.

It works in both directions:

**Read** — turn a Figma selection into framework-aware code, grounded on faithful, de-duplicated design context (layout, typography, variables, components).

<p align="center">
  <img alt="Figwright turning a Figma selection into code" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/figma-to-code.gif" width="820">
</p>

**Write** — author and edit the canvas directly: frames, text, auto-layout, styles, variables, components, whole screens.

<p align="center">
  <img alt="Figwright building a design directly on the Figma canvas" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/code-to-figma.gif" width="820">
</p>

Everything runs on your machine and talks to Figma through a plugin, so it needs **no Figma Dev Mode seat** and **no paid tier**.

## Why Figwright

- **Free** — no Figma Dev Mode or paid seat. The official Dev Mode MCP is gated; Figwright isn't.
- **Bidirectional** — not read-only. **93 tools** span reading _and_ writing the canvas, so an agent can both implement designs and build them.
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

## The plugin

The Figma-side plugin isn't a black box. It shows every call as it happens, lets you inspect the exact payload sent to the model, and surfaces its own connection health.

<table>
  <tr>
    <td width="50%" align="center" valign="top">
      <img alt="Activity tab — every tool call with timing" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/plugin-activity.png" width="400"><br>
      <sub><b>Activity</b> — every tool call, with timing</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img alt="Payload inspector — the exact data sent to the model" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/plugin-payload.png" width="400"><br>
      <sub><b>Payload inspector</b> — the exact data sent to the model</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img alt="Context tab — file, page, and current selection" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/plugin-context.png" width="400"><br>
      <sub><b>Context</b> — file, page, and current selection</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img alt="Debug tab — connection health and a one-click diagnostic bundle" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/plugin-debug.png" width="400"><br>
      <sub><b>Debug</b> — connection health and a one-click diagnostic bundle</sub>
    </td>
  </tr>
</table>

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
| [`figma‑codegen`](./skills/figma-codegen/SKILL.md) | Turn a Figma selection into framework-aware code, grounded on your stack and existing components.   |
| [`figma‑build`](./skills/figma-build/SKILL.md)     | Build a Figma design from code or a description, reusing the file's existing components and styles. |

Install across any supported agent with the [`skills`](https://www.skills.sh) CLI:

```bash
npx skills add awdr74100/figwright/skills      # both
npx skills add https://github.com/awdr74100/figwright/tree/main/skills/figma-codegen  # one
```

> [!NOTE]
> Skills need the `@figwright/mcp` server connected — on their own they have no tools to drive.

## Tools

Figwright exposes **93 MCP tools** in three groups:

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
<summary><strong>The server won't start — <code>command not found</code>, or it fails / disconnects with <code>-32000</code> ("Connection closed").</strong></summary>

Both come down to how your MCP client launches the server: it spawns the `command` directly, **not** through your interactive shell, so it inherits none of what your shell sets up. That bites hardest when Node is managed by a version manager (**fnm, nvm, asdf, volta, mise**), since those configure `PATH` and npm from shell hooks that only run in a real terminal. It isn't specific to Figwright — it affects any `npx`-launched MCP server. There are two symptoms, with two different fixes.

**`command not found` — the client can't find `npx` / `node` on its `PATH`.**

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

- **Or pass `PATH` through `env`.** If your client supports a per-server `env`, add your version manager's `bin` directory to `env.PATH`.

**`-32000` / "Connection closed" / it just never connects — `npx` runs, but the server exits before the handshake.**

`npx … @latest` re-resolves the package from the registry on **every** launch. In a directly-spawned environment that step can fail or stall — empty or different npm config, a corporate proxy or private registry that isn't configured there, or no network — so the process dies before MCP connects and the client reports the connection as closed. (A missing `node` for the binary's shebang lands here too.)

The fix is to install the package so launch needs no registry fetch:

- **As a project dependency — the quickest unblock.** Install it, then **drop `@latest`** from your config. The `@latest` tag is what forces the registry round-trip; without it, `npx` uses the copy already in `node_modules` (a project-scoped config like Claude Code's `.mcp.json` runs from your project root):

  ```bash
  pnpm add -D @figwright/mcp   # or: npm i -D @figwright/mcp
  ```

  ```json
  {
    "mcpServers": {
      "figwright": {
        "command": "npx",
        "args": ["-y", "@figwright/mcp"]
      }
    }
  }
  ```

- **Or globally, pinned to the binary.** Install once, then point `command` straight at it — no `npx`, no per-launch resolution. Use the absolute path from `which figwright-mcp`:

  ```bash
  npm i -g @figwright/mcp
  which figwright-mcp
  ```

  ```json
  {
    "mcpServers": {
      "figwright": {
        "command": "/absolute/path/to/figwright-mcp"
      }
    }
  }
  ```

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

## Contributing

Contributions are welcome. See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for how to get set up and open a pull request, and **[AGENTS.md](./AGENTS.md)** for the architecture, repo layout, tech stack, and conventions.

## What's in the name

`figwright` follows the **_-wright_** tradition — an old English word for a maker or craftsman: a **playwright** writes plays, a **shipwright** builds ships, a **wheelwright**, wheels. The name is a nod to [**Playwright**](https://playwright.dev), which automates the browser. Where Playwright drives the browser, **Figwright** drives Figma — a maker of designs that both reads the canvas and crafts work back onto it.

## License

[MIT](./LICENSE) © Roya
