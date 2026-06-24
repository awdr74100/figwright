---
name: figma-codegen
description: Generate framework-aware code from a Figma design. Reads the project's stack profile and emits code matching the existing framework (React/Vue/Svelte/Next/etc.) and styling (Tailwind/CSS/CSS-in-JS), reusing existing components and design tokens instead of regenerating from scratch. Triggers whenever the user wants a Figma design turned into code — e.g. 'code this design', 'implement this frame', 'build this screen/component', 'turn this Figma into React/Vue', 'convert this design to code' — or whenever a Figma URL or the current Figma selection appears alongside a coding request. Works for full screens, single sections, or one component.
---

# figma-codegen

Turn a Figma selection into code that looks like the rest of the project: reuse the components and
tokens that already exist, only build what's genuinely missing. The grounded tools do the heavy
lifting so you are not guessing from a screenshot. This file is the router; deep detail lives in
[`references/`](./references) — load a reference when its step is in play.

## When to use

- The user pastes a Figma URL/selection and asks for code ("code this", "build this component").
- The user wants to extend an existing component to match a Figma frame.

## Workflow

Run the grounded tools against the selection, then generate — **trust them over the rendered image.**

1. **`get_design_context`** (detail `full`, `dedupeComponents: true`) → the structural tree with
   tokens resolved to names (`Primary/500`, `spacing/4`), styles deduped into `globalVars`, and each
   instance's `mainComponent` / `componentProperties`. This is the layout + binding source of truth.
   Keep `dedupeComponents: true` and don't depth-limit a subtree you'll build from.
   → **How to read the tree, the per-node fidelity catalog (effects, per-side borders, stroke align,
   per-corner radius, blend, masks, gradients, image-fit, auto-layout/grid), and grounding a page too
   big for one call: [`references/grounding.md`](./references/grounding.md).**

2. **`component_map`** → every Figma component grouped to a local code component with a `status`
   (high / medium / low / unmapped), `candidate.filePath`, and `matchedProps`.
   - `high` / `medium`: **reuse that component** (import from `candidate.filePath`), don't regenerate.
     Never invent a component name `component_map` didn't report.
   - Wire each entry's `instances[].props` (resolved variant / boolean / text values) onto the reused
     component — one element per instance, with its own props.
   - `candidate.unmatchedProps`: Figma axes the component has no prop for (a leading icon, a `required`
     flag, an active state) → surface as component-extension TODOs, never fake them with ad-hoc markup.
   - `unmapped`: build it new in the project's style. For a **repeated** unmapped component
     (`instanceCount > 1`), build from its **first instance's** subtree; if that came back
     `deduped`/`truncated`, drill `get_design_context` on `instances[0].nodeId` once — don't rebuild a
     repeated component by eye.
   - When you're emitting a component's **own definition** (its prop types, not just rendering it),
     `get_component_api` on the component/instance returns the full property API — every VARIANT option
     and each BOOLEAN/TEXT/INSTANCE_SWAP prop with its default — so the prop space is grounded, not
     inferred from the instances you happened to see.

3. **`token_map`** → every Figma variable joined to a project token with `status` + `ref` + `matchedBy`.
   - mapped: reference `candidate.ref` (`bg-primary-500`, `var(--color-primary-500)`) — never the raw
     hex/px `get_design_context` resolved. `matchedBy: ['name']` on a colour (value drifted): use it
     but flag the mismatch.
   - `framework-builtin` (Tailwind built-in scale step, e.g. `spacing/4`, `line-height/7`,
     `weight/Bold`): carries `builtin: { scale, step }` — compose the utility (`p-4`/`gap-4`,
     `leading-7`, `font-bold`), **not** an arbitrary `p-[16px]`. This is **not** a gap.
   - `unmapped`: use the value but call out the gap (offer to add it to the token source); don't
     hardcode silently.

4. **Export the assets grounding can't carry** — logos, photos, icons have no pixels and otherwise
   render as grey blocks. `get_screenshot` (and `icon_map` first for icons, to reuse curated `.svg`s).
   → **Full asset/icon/svg/colour-contract workflow:
   [`references/assets-and-icons.md`](./references/assets-and-icons.md).**

Then emit code in the detected stack (the profile comes back on `component_map` / `token_map`; you do
not call `analyze_project` yourself): compose the reused components, wrap unmapped pieces, and apply
token references for colour/spacing/radius/typography.

## Responsive & verify

- **Responsive by default** — root is `w-full`, never the artboard's fixed width; ground breakpoints
  from the file's other-width frames. → [`references/responsive.md`](./references/responsive.md).
- **Verify visually before you call it done** — render with the project's toolchain, screenshot at the
  design's viewport, diff against the Figma node, fix at the source.
  → [`references/verify.md`](./references/verify.md).

## Rules

- **Ground every section — never eyeball a value off the screenshot.** Every px size, colour,
  font-size, radius, and spacing comes from `get_design_context`, for _every_ section. The screenshot
  is visual intent only; guessing "the easy sections" is the cardinal miss. On a page too big to ground
  at once, scope by section `nodeId` — never depth-cap the whole page, never retry an oversized call.
- **Reuse beats regenerate.** A `high`/`medium` `component_map` candidate must be imported and used.
- **Reference tokens, not literals.** Emit a mapped variable's `ref`; reserve raw values for `unmapped`
  gaps, and surface those gaps rather than burying them.
- **Carry every visual property, don't drop fidelity.** Effects, per-side borders + `strokeAlign`,
  per-corner radius, blend mode, masks, gradients, image `scaleMode`, and auto-layout/grid spacing are
  all in the context — translate each (the catalog is in `references/grounding.md`). Dropping any is a
  grounding miss, not a simplification.
- **Export visual assets, don't fake them.** A grey box or a hand-typed wordmark is a miss.
- **Match the project, not a house style.** Mirror the existing import style, file layout, and naming.
- **Render and verify before you call it done.** (See `references/verify.md`.)
- Never write a config file or wizard prompt; everything is inferred from the project + the tools.
