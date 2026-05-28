---
name: figma-codegen
description: Generate framework-aware code from a Figma selection. Reads the user's project profile and emits code that matches the existing stack (React/Vue/Svelte + Tailwind/CSS), reusing existing components and design tokens instead of regenerating them. Triggers when the user asks to "code this design", "build this component", or references a Figma URL/selection.
min-server-version: 0.1.0
---

# figma-codegen

Turn a Figma selection into code that looks like the rest of the project: reuse the components and
tokens that already exist, only build what's genuinely missing. Three grounded tools do the heavy
lifting so you are not guessing from a screenshot.

## When to use

- The user pastes a Figma URL/selection and asks for code ("code this", "build this component").
- The user wants to extend an existing component to match a Figma frame.

## How to use

Run these three tools against the selection, then generate. They are the grounding — trust them over
the rendered image.

1. **`get_design_context`** (detail `full`) on the node → the structural tree with **tokens already
   resolved to names** (e.g. `Primary/500`, `spacing/4`), styles deduped into `globalVars`, and each
   instance's `mainComponent` / `componentProperties` (variant values). This is the layout + binding
   source of truth — there is no need to hand-resolve variable ids or read raw hex.
2. **`component_map`** on the same node → every Figma component grouped to a local code component with
   a `status` (high / medium / low / unmapped), `candidate.filePath`, and `matchedProps`.
   - `high` / `medium`: **reuse that component** (import from `candidate.filePath`), do not regenerate.
   - `unmapped`: build it new, in the project's style — and it's a candidate for a new shared component.
   - Each entry's `instances[]` carries the per-instance `props` (resolved variant / boolean / text
     values, e.g. `{ Size: "Medium", Type: "Primary", "show 必填": true }`). Wire those onto the reused
     component — one element per instance, with its own props — instead of a single generic element.
3. **`token_map`** → every Figma variable joined to a project token with `status` + `ref` (the Tailwind
   utility base or `var(--…)`) + `matchedBy` (`name` / `value`).
   - mapped: reference `candidate.ref` (e.g. `bg-primary-500`, `var(--color-primary-500)`) — never the
     raw hex/px that `get_design_context` resolved.
   - `matchedBy: ['name']` on a color (value drifted): use it, but flag the value mismatch to the user.
   - in `unmapped`: the design uses a token the project hasn't defined. Don't hardcode silently — use the
     value but call out the gap (and offer to add it, or hand off to **figma-sync-tokens**).

Then emit code in the detected stack (the profile comes back on `component_map` / `token_map`; you do
not call `analyze_project` yourself). Compose the reused components, wrap unmapped pieces, and apply
token references for color/spacing/radius/typography.

## Rules

- **Reuse beats regenerate.** A `high`/`medium` `component_map` candidate must be imported and used, not
  re-implemented. Never invent a component name `component_map` didn't report.
- **Reference tokens, not literals.** If `token_map` maps a variable, emit its `ref`; reserve raw values
  for the `unmapped` gaps, and surface those gaps rather than burying them.
- **Match the project, not a house style.** Mirror the existing import style, file layout, and naming.
- Never write a config file or wizard prompt; everything is inferred from the project + the three tools.
- If a reused component lacks a prop the design needs (e.g. a `required` field, a password toggle), say
  so — that's a real extension the component needs, not something to fake with ad-hoc markup.
