---
name: figma-build
description: Build a Figma design from code or a description — the reverse of figma-codegen. Reuses the connected file's existing design system (components, variables, styles) instead of drawing primitives with hardcoded values. Triggers whenever the user wants something created or updated IN Figma from code or a spec — e.g. 'build this in Figma', 'create a Figma design for this', 'push this component/screen to Figma', 'turn this React/Vue into a Figma design', 'recreate this UI in Figma', 'make a Figma version of …', 'design a landing page/screen in Figma' — or whenever a coding artifact (a component, page, or spec) appears alongside a request to author in a connected Figma file. Works for full screens, sections, single components, or design-system assets.
min-server-version: 0.1.0
---

# figma-build

Turn code or a description into a Figma design that looks like it belongs in the file: **reuse the
components, variables, and styles that already exist, and only build what's genuinely missing.** This
is the mirror image of `figma-codegen` — same "reuse beats regenerate / reference tokens not
literals" philosophy, pointed at the canvas instead of the codebase. This file is the router; deep
detail lives in [`references/`](./references) — load a reference when its step is in play.

You operate on the **connected** Figma file (the plugin's current session). There is no fetch-by-URL;
the user must have the target file open. Confirm a plugin is connected (`ping`) before building.

## When to use

- The user wants to **create or update** something in Figma from code or a description — a screen,
  view, modal/dialog/drawer/sidebar/panel, a single component, or a design-system asset.
- **Not** for reading a Figma design into code — that's `figma-codegen`.

## First, ground in the design system (reuse beats regenerate)

The write-side mirror of codegen's grounding. The file almost certainly has a design system whose
components/tokens correspond to the source UI. **Discover it first, then instance/bind it** — don't
redraw boxes with hex.

1. **`get_variable_defs`** → the file's variables (colour / spacing / radius / typography) with
   names + values + `hex`. These are the tokens you bind to.
2. **`scan_components`** / **`get_local_components`** → existing components to **instance** rather
   than rebuild. Match the source UI pattern (a card, a list row, a nav, a button) to a component.
3. **`get_styles`** → shared paint / text / effect styles to apply.

Decide per element: **reuse** an existing component/variable/style, or **build new** only what the
system genuinely lacks.

## Two jobs — both follow the write rules

Every build obeys the same cross-cutting rules — reference tokens (colour via
`bind_variable_to_paint`, scalars via `bind_variable_to_node`, shared looks via
`apply_style_to_node`), auto-layout for related children (absolute only for top-level placement),
append-then-fill sizing (`layoutGrow`/`layoutAlign`, no FILL/HUG enum), and real fonts (a new TEXT
node defaults to Inter). → **[`references/write-rules.md`](./references/write-rules.md).**

- **Assemble a screen / component from what exists** (the common case): recognise the UI pattern,
  `create_instance` matching components, bind tokens, build incrementally, screenshot-verify each
  step. → **[`references/assemble-screens.md`](./references/assemble-screens.md).**
- **Author a new design-system asset** (only when grounding found no equivalent): create
  variables/collections, paint/text styles, or components + variant sets, then switch back to the
  reuse path. → **[`references/author-design-system.md`](./references/author-design-system.md).**

## Verify visually (close the loop)

`get_screenshot` the built node, compare it to the source intent, fix discrepancies, and
re-screenshot — the same render-and-diff discipline codegen uses, in reverse. An `empty: true` export
means the node rendered nothing (hidden / off-canvas).

## Rules

- **Reuse beats regenerate.** Instance existing components; bind existing variables/styles. Build new
  only what the system lacks, and name/structure it to fit.
- **Reference tokens, not literals.** Colour via `bind_variable_to_paint`, scalars via
  `bind_variable_to_node`, shared looks via `apply_style_to_node` — never hardcode hex/px when a
  token exists (`get_variable_defs` tells you what does).
- **Auto-layout for related children**, absolute coordinates only for top-level placement.
- **Build incrementally and validate** (screenshot) — recognise the UI pattern and assemble it from
  the matching components, don't reproduce it from primitives.
- **Match the file's conventions** — naming, structure, and the design system's own patterns, the
  way codegen mirrors the project's existing code style.
