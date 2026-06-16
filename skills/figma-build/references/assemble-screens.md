# Assembling screens & components

Loaded when building a screen, section, or component **from the file's existing design system** — the
common case. Recognise the source UI's pattern, then assemble it from matching components and bound
tokens. Work in small steps and check each; don't emit a huge tree blind. Binding/layout/sizing
mechanics live in `write-rules.md`.

## 1. Container + auto-layout

`create_frame` for the container, then `set_auto_layout` (`HORIZONTAL` / `VERTICAL` / `GRID`) with the
padding / itemSpacing / alignment the source layout implies. Children that stack, sit side-by-side, or
are gapped belong in auto-layout — only the top-level container is placed with absolute `x`/`y`.

## 2. Reuse components — don't rebuild internals

Match the source pattern (a card, a list row, a nav, a button) to an existing component from
`scan_components` / `get_local_components`, and **`create_instance`** it:

- `componentId` for a local component, `componentKey` for a published / library one.
- Set its variant / properties on the instance rather than rebuilding the component's internals.
- One instance per occurrence, each with its own props — the write-side mirror of codegen wiring
  `instances[].props`.

Only build a piece from primitives when no component matches (then consider whether it should _become_
a component — see `author-design-system.md`).

## 3. Append, then size and fill

Append each child into its auto-layout parent **first**, then `set_layout_props` to fill or hug
(`layoutGrow` / `layoutAlign` — see `write-rules.md`). A child can't fill before it's in a layout.

## 4. Text

`create_text` / `set_text` for content, then `set_text_properties` to set the real font (a new TEXT
node defaults to Inter, not the system font — see `write-rules.md`). Bind `characters` to a `STRING`
variable when the copy is tokenised.

## 5. Reference tokens for every value

Colour via `bind_variable_to_paint`, scalars (size / padding / gap / radius) via
`bind_variable_to_node`, shared looks via `apply_style_to_node`. Don't hardcode a hex/px the file has
a token for (`write-rules.md` has the three paths).

## 6. Verify visually — close the loop

`get_screenshot` the built node, compare it to the source intent, fix discrepancies, re-screenshot —
the same render-and-diff discipline codegen uses, in reverse. An `empty: true` export means the node
rendered nothing (hidden / off-canvas / no visible content) — check it's appended, visible, and on
the canvas.

## Large builds: section by section

Build a big screen the way codegen grounds one — **a section at a time**, verifying each before moving
on, rather than emitting the whole tree blind and screenshotting at the end. Assemble the first
section, screenshot, fix, then the next — errors stay local and cheap to correct.
