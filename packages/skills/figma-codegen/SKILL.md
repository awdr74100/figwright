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

1. **`get_design_context`** (detail `full`, `dedupeComponents: true`) on the node → the structural tree
   with **tokens already resolved to names** (e.g. `Primary/500`, `spacing/4`), styles deduped into
   `globalVars`, and each instance's `mainComponent` / `componentProperties` (variant values). This is
   the layout + binding source of truth — there is no need to hand-resolve variable ids or read raw hex.
   - **Keep `dedupeComponents: true`, and do not depth-limit a tree you intend to build from.** Dedupe
     shows the **first** instance of each repeated component in full and collapses the rest to a
     `"deduped": true` stub — so a 100-instance screen stays readable while every distinct component
     keeps one complete copy. A `deduped` (or `truncated`) sibling means "identical to the first one,
     reuse that structure"; a depth cap, by contrast, throws the structure away — that's the trap that
     makes repeated rows/cards look empty.
   - **Carry per-node visual properties, not just layout.** Each node also exposes `fills`, `strokes`,
     `cornerRadius`, `opacity`, and **`effects` / `styleIds.effect`** — translate every one to the
     stack's equivalent. **Effects (drop/inner shadow, blur) are the easiest fidelity to lose**: they
     come from a _shared effect style_ so they read as one field on the node and quietly vanish in
     generation. A card that has a shadow in Figma but flat output is the classic miss (e.g. a
     `DROP_SHADOW 0/4/8 #0000000D` → `shadow-[0_4px_8px_rgba(0,0,0,0.05)]`).
2. **`component_map`** on the same node → every Figma component grouped to a local code component with
   a `status` (high / medium / low / unmapped), `candidate.filePath`, and `matchedProps`.
   - `high` / `medium`: **reuse that component** (import from `candidate.filePath`), do not regenerate.
   - `unmapped`: build it new, in the project's style — and it's a candidate for a new shared component.
     For a **repeated** unmapped component (`instanceCount > 1`, e.g. a table row or card), build from
     its **first instance's** full subtree in the step-1 tree (the deduped siblings just repeat it). If
     that subtree came back `deduped`/`truncated` because the overview was scoped down, drill it once:
     `get_design_context` on the entry's `instances[0].nodeId` — don't reconstruct a repeated component
     by eye from the screenshot.
   - Each entry's `instances[]` carries the per-instance `props` (resolved variant / boolean / text
     values, e.g. `{ Size: "Medium", Type: "Primary", "show 必填": true }`). Wire those onto the reused
     component — one element per instance, with its own props — instead of a single generic element.
   - `candidate.unmatchedProps`: Figma axes the reused component has **no prop for** (e.g. a leading
     icon, a `required` flag, an active state). Reuse the component, but surface these as
     component-extension TODOs — don't silently drop them or fake them with ad-hoc markup.
3. **`token_map`** → every Figma variable joined to a project token with `status` + `ref` (the Tailwind
   utility base or `var(--…)`) + `matchedBy` (`name` / `value`).
   - mapped: reference `candidate.ref` (e.g. `bg-primary-500`, `var(--color-primary-500)`) — never the
     raw hex/px that `get_design_context` resolved.
   - `matchedBy: ['name']` on a color (value drifted): use it, but flag the value mismatch to the user.
   - `framework-builtin` (Tailwind projects): the variable is a built-in scale step the project never
     redeclares in `@theme` — e.g. `spacing/4`, `line-height/7`, `weight/Bold`. It carries `builtin: {
scale, step }`: for `spacing`, compose the step with the property `get_design_context` bound it to
     (`p-4` / `gap-4` / `m-4`); for `line-height`, use `leading-{step}` (`leading-7`); for `font-weight`,
     use `font-{step}` (`font-bold`). Use the utility, **not** an arbitrary value like `p-[16px]`. This
     is **not** a gap — never report it as a missing token.
   - in `unmapped`: the design uses a token the project hasn't defined. Don't hardcode silently — use the
     value but call out the gap (and offer to add it, or hand off to **figma-sync-tokens**).
4. **`get_screenshot` — export the assets the structural tools can't carry.** Geometry + text grounding
   has **no pixels**: logos, photos, and icons otherwise come out as grey blocks, which is the single
   biggest fidelity gap on real-world files (often half the visible surface). For each visual-only leaf,
   export the node instead of placeholdering or hand-typesetting it:
   - a node with an **`IMAGE` fill** (a photo/product-shot rectangle) → `get_screenshot` `PNG` (scale 2);
   - a **`VECTOR`** / boolean-op, or an **icon instance** (e.g. `mainComponent.name` under `Icons/…`, a
     small square instance) → `get_screenshot` `SVG`;
   - **logos / brand marks are always exported**, never typed by hand.
     Save under the project's asset dir (`src/assets`, `public/…`) and wire the real file in. This is the
     one place you go to the image — not to guess layout, but to fetch a pixel asset grounding can't encode.

Then emit code in the detected stack (the profile comes back on `component_map` / `token_map`; you do
not call `analyze_project` yourself). Compose the reused components, wrap unmapped pieces, and apply
token references for color/spacing/radius/typography.

## Rules

- **Reuse beats regenerate.** A `high`/`medium` `component_map` candidate must be imported and used, not
  re-implemented. Never invent a component name `component_map` didn't report.
- **Reference tokens, not literals.** If `token_map` maps a variable, emit its `ref`; reserve raw values
  for the `unmapped` gaps, and surface those gaps rather than burying them.
- **Match the project, not a house style.** Mirror the existing import style, file layout, and naming.
- **Export visual assets, don't fake them.** Logos, photos, and icons have no grounding pixels —
  `get_screenshot` the node and import the file. A grey box or a hand-typed wordmark is a miss, not a
  fallback.
- **Don't drop effects.** A node's `effects` / shared `styleIds.effect` is in the context — emit the
  shadow/blur. Flat cards where the design has a drop shadow is a grounding miss, not a simplification.
- Never write a config file or wizard prompt; everything is inferred from the project + the three tools.
- If a reused component lacks a prop the design needs (e.g. a `required` field, a password toggle), say
  so — that's a real extension the component needs, not something to fake with ad-hoc markup.
  `component_map` reports these directly as `candidate.unmatchedProps`; turn them into TODOs.
