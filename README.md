<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/logo-full-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/logo-full-light.svg">
  <img alt="Figwright" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/logo-full-light.svg" width="480" height="240">
</picture>

Where Playwright drives the browser, Figwright drives Figma.

[Quick start](#quick-start) · [How it works](#how-it-works) · [Tools](#tools) · [Skills](#skills) · [FAQ](#faq) · [Contributing](#contributing)

[![npm](https://img.shields.io/npm/v/@figwright/mcp?logo=npm&color=cb3837)](https://www.npmjs.com/package/@figwright/mcp)
[![CI](https://github.com/awdr74100/figwright/actions/workflows/ci.yml/badge.svg)](https://github.com/awdr74100/figwright/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

<a href="https://trendshift.io/repositories/68274?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-68274" target="_blank" rel="noopener noreferrer"><img alt="Figwright on Trendshift" src="https://trendshift.io/api/badge/trendshift/repositories/68274/daily?language=TypeScript" width="250" height="55"></a>

</div>

## What is Figwright?

Figwright connects an **MCP server** to a **Figma plugin** over a local WebSocket relay, so an AI agent — Claude Code, Cursor, Codex, or any other MCP client — can work _with_ Figma instead of just looking at it.

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
- **Bidirectional** — not read-only. **112 tools** span reading _and_ writing the canvas, so an agent can both implement designs and build them.
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

<p align="center">
  <img alt="The Figwright panel: an activity log of tool calls, an expanded call showing the exact payload sent to the model, and a debug tab with connection and call statistics" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/plugin-panel.png" width="820">
</p>

<p align="center">
  <sub><b>Activity</b> — every call, with timing and a jump to the nodes it touched · <b>Payload</b> — exactly what the model received · <b>Debug</b> — health, versions, and a one-click diagnostic bundle</sub>
</p>

And it follows your Figma theme, light or dark.

<p align="center">
  <img alt="The same panel side by side in Figma's light and dark themes" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/plugin-theme.png" width="616">
</p>

The window is yours to arrange. Drag the bottom-right corner to resize it — a taller panel keeps more of the log in view, and the size is remembered next time you open it. Or send it to the background: the panel gets out of your way while the connection stays live, so a long-running agent keeps working.

<p align="center">
  <img alt="The same panel at two sizes: a narrow one showing three calls with its resize corner highlighted, and a wider one showing five, with the run-in-background button highlighted in the header" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/plugin-window.png" width="602">
</p>

<p align="center">
  <sub><b>Resize</b> — drag the corner, the size sticks · <b>Background</b> — the panel hides, the relay stays connected</sub>
</p>

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

Figwright exposes **112 MCP tools** in three groups:

- **Read** — selection, document and node inspection, styles, variables, components, fonts, reactions, motion (animation) state, screenshots, original image-fill assets, PDF export, and video export of animated frames (MP4 / GIF / WebM).
- **Write** — create and edit frames, text, shapes, auto-layout, effects, styles, variables, components (including authoring their boolean/text/instance-swap properties), pages, reactions, and Motion animations (keyframes, animation-style presets, timelines); plus a `batch` tool to apply many edits at once.
- **Grounding** — `get_design_context` for faithful, de-duplicated design context, and `component_map` / `token_map` / `icon_map`, which join Figma data to your codebase so codegen reuses what you already have; plus `design_diff`, which reports what changed in a design against a saved baseline so you update only the affected code.

> [!TIP]
> Your MCP client lists every tool at connect time — that's always the authoritative, up-to-date catalog.

## Requirements

- An **MCP client** (Claude Code, Cursor, …).
- **Node.js 20.19+ or 22.12+** — the server runs via `npx`, as its own process, so this is independent of the Node version your project builds with. (This is the modern-Node baseline; Node 18/21 and 22.0–22.11 aren't supported.)
- **Figma** — the free tier is enough; the desktop app is needed to import the plugin in development.

## Security

Figwright runs entirely on your machine: your client launches the server over stdio, the server relays to the plugin over a WebSocket on `127.0.0.1:3055`, and nothing is sent anywhere else. The plugin uses only Figma's public Plugin API, so it reaches the file you have open and nothing beyond it.

Loopback is not on its own a boundary — a web page you visit can still reach a local port — so the relay gates every request on two headers a page cannot forge: **`Host`**, which must name loopback (this is what stops DNS rebinding), and **`Origin`**, which admits the plugin's sandboxed handshake and refuses browsers everywhere else. The leader's HTTP endpoints additionally require a media type that cannot be sent without a CORS preflight. See [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices) for the wider picture, and [SECURITY.md](./SECURITY.md) for Figwright's threat model, what is in and out of scope, and how to report a vulnerability privately.

**Figwright is not a substitute for reviewing what your agent does.** Its write tools change your Figma file and its export tools write files to paths the agent chooses; an agent acting on a malicious design or a prompt-injected instruction can misuse both. Your MCP client's tool-approval controls are the boundary that matters.

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
<summary><strong>Does it work in Dev Mode and FigJam?</strong></summary>

It runs in both, with less available than in Figma Design — because those editors give plugins less, not because Figwright holds anything back.

- **Figma Design** — everything.
- **Dev Mode** (Inspect panel) — reads and exports only. Figma makes plugins read-only there, so screenshots, PDF export and every inspection tool work, while every write fails — nodes, pages, variables and styles alike. That suits the codegen direction; use Design mode to build.
- **FigJam** — frames, sections, shapes and text work; components, variables, styles and Motion don't exist in that editor, so the tools for them don't apply.

`get_metadata` reports the editor (`editorType` / `mode`), and any tool that fails because of the editor says so in its error, so an agent can re-plan rather than retry.

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
