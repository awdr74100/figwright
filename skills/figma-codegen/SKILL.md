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
   per-corner radius, blend, masks, gradients, image-fit, auto-layout/grid, aspect-ratio,
   scroll/sticky, stack & stroke-space), Dev Mode annotations as ground truth, and grounding a page
   too big for one call: [`references/grounding.md`](./references/grounding.md).**

2. **`component_map`** → every Figma component grouped to a local code component with a `status`
   (high / medium / low / unmapped), `candidate.filePath`, and `matchedProps`.
   - `high` / `medium`: **reuse that component** (import from `candidate.filePath`), don't regenerate.
     Never invent a component name `component_map` didn't report.
   - `candidate.ambiguousWith` (a capped list of `{ name, filePath }`): the Figma name matched two or
     more code components nearly equally and the join couldn't confidently pick — a **verify-me** pick,
     not a confident reuse (the analogue of `token_map`'s `ambiguousWith`). Check which of the winning
     `candidate` + these runner-ups is the right component for _this_ context before importing (a wrong
     reuse is a silent visual bug), then record the confirmed one in the map file so the next run is
     certain. Absent when the pick was unambiguous.
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
   A document's shared paint styles (single solid color styles — the token mechanism of
   pre-variables files) join the same way, marked `source: 'style'`.
   - mapped: reference `candidate.ref` (`bg-primary-500`, `var(--color-primary-500)`) — never the raw
     hex/px `get_design_context` resolved. `matchedBy: ['name']` on a colour (value drifted): use it
     but flag the mismatch.
   - `candidate.ambiguousWith` (several project tokens share that exact value and the name couldn't
     split them): a capped, verify-me pick — choose the semantically right sibling for the context
     (or keep the value and flag the gap), never treat it as a confirmed reuse.
   - On a document with few or no variables (most real-world files), `get_design_context`'s own
     `projectTokens` map is the fallback: any raw color in the payload that exactly equals a project
     token's value is annotated there (`{ "#6266F0": { ref, name, matchedBy: ["value"] } }`). Before
     hardcoding a hex, look it up and emit the `ref` when it fits the context semantically.
     `matchedBy: ["value"]` marks the entry as name-blind value-equality evidence — a hypothesis to
     verify, not a resolved binding: an entry with `candidates` lists same-value tokens to choose
     between by meaning, a semantically wrong token is **worse** than the raw value (keep the raw
     value and note the gap instead), and a bound Figma variable always outranks a raw-value match.
   - `framework-builtin` (a built-in scale step of the project's utility framework — Tailwind or
     UnoCSS — e.g. `spacing/4`, `line-height/7`, `weight/Bold`): carries `builtin: { scale, step }`
     — compose the utility (`p-4`/`gap-4`, `leading-7`, `font-bold`), **not** an arbitrary
     `p-[16px]`. This is **not** a gap.
   - `from` (a SCSS variable): the ref does **not** resolve on its own. The file you write must
     import the declaring file, and `from` is **repo-relative** while Sass resolves `@use` against
     the _importing_ file — so re-resolve it from where you are writing: from
     `src/components/card.scss`, `from: src/styles/_tokens.scss` becomes
     `@use '../styles/tokens' as *`, never the repo-relative path verbatim. `as *` keeps the ref as
     given; the project's own `@use` style may namespace it instead (`@use '../styles/tokens'` makes
     `$color-primary-500` into `tokens.$color-primary-500`). Emitting the ref without the import is
     a **compile error**, not a style nit.
   - `unmapped`: use the value but call out the gap (offer to add it to the token source); don't
     hardcode silently.
   - `figmaModes` (`{ Light: …, Dark: … }`, with the file's theme axes on `themedCollections`): the
     token is **theme-dependent** — `figmaValue` is only the default mode, never the whole story.
     Mapped: emit `candidate.ref` and confirm the project token itself switches per theme (`.dark` /
     `[data-theme]` / `prefers-color-scheme` / a `dark:` story); if the project defines only one
     value, wire the other mode's value into that mechanism or surface a theme gap. Unmapped: the
     default mode is the base, other modes ride the project's dark-mode mechanism (`dark:` variants /
     `prefers-color-scheme`). Themes encoded without native modes — paired collections or name
     groups (`Color/Light/*` + `Color/Dark/*`, a plan-limited workaround) — get the same treatment.

4. **Export the assets grounding can't carry** — logos, photos, icons have no pixels and otherwise
   render as grey blocks. `save_image_fills` for `IMAGE`-fill nodes (the original asset, not a
   clipped re-render), `icon_map` first for icons (reuse curated `.svg`s), `get_screenshot` only for
   the composited look.
   → **Full asset/icon/svg/colour-contract workflow:
   [`references/assets-and-icons.md`](./references/assets-and-icons.md).**

Then emit code in the detected stack (the profile comes back on `component_map` / `token_map`; you do
not call `analyze_project` yourself): compose the reused components, wrap unmapped pieces, and apply
token references for colour/spacing/radius/typography.

## Keep code in sync as the design changes

Codegen is rarely one-shot — the design keeps moving. To make the second pass an incremental edit
instead of a regeneration:

- **After you generate**, `design_diff` on the section/component `nodeId` saves a baseline (its
  `get_design_context`) under `.figwright/snapshots/`. Committing that file lets teammates share the
  baseline; the tool never touches git.
- **When asked to re-sync** ("the design changed, update the component"), `design_diff` the same
  `nodeId` again: it returns the per-node, per-property delta — `added` / `removed` / `changed` nodes
  with resolved values (a fill, a padding, a text string, a token rebind), each with a readable `path`
  (`Card / Header / Title`). Edit only the code those nodes map to; don't regenerate the screen.
  Ground each changed value the usual way (it's a `get_design_context` slice), then `design_diff` with
  `update: true` to accept the new design as the baseline.
- Scope it by the same `nodeId` unit you coded from. `no-changes` means the design is untouched since
  the baseline — nothing to do.

## Record verified mappings (so the next run reuses, not re-guesses)

The joins re-derive from scratch every run. A mapping you **confirmed** — reused a component and it
rendered right, resolved an ambiguous colour to the semantically correct token — is worth recording
so the next run treats it as ground truth instead of re-guessing. Two append-only map files, each read
back by its join as highest authority:

- **`docs/figma-component-map.md`** — rows `| FigmaName | code/path |` (or `FigmaName -> path`).
  `component_map` then returns that component as `source: 'map-file'`, confidence 1.
- **`docs/figma-token-map.md`** — rows `| FigmaName | ref |`. `token_map` returns it as
  `matchedBy: ['map-file']`, confidence 1. The `ref` is what you'd emit — a utility (`bg-primary-500`),
  a `var(--color-primary-500)`, or the bare token name.

- **A recorded row OVERRIDES the fuzzy join on every future run — so record proof, not a pick.** The
  gate is your own verify step (§ Responsive & verify): only after you rendered the result and it
  matched the Figma node do you record the mapping you _proved_. A wrong row doesn't fail loudly — it
  silently mis-maps that component/token in every future generation until a human notices, which is
  worse than no record at all. If you're not certain, don't record it; a re-guess next run is
  recoverable, a confidently-wrong recorded row is not.
- **Record only the mappings the join was unsure of** — a `low`/`medium` component match you
  confirmed, an `unmapped` component you built (record its new file), or a token that came back
  `ambiguousWith` / `matchedBy: ['value']` / `unmapped` and you resolved by meaning. Skip the
  already-`high` deterministic matches; they re-derive correctly and a row for them is just noise.
- **These files are committed project docs — treat a row like a line of code you're asserting is
  correct**, not a scratch note. One figma name → one target per row; keep them reviewable.
- **Keep the files healthy.** When `component_map` / `token_map` report `staleOverrides` (a recorded
  target that no longer resolves — the file/token was renamed or deleted), the join has already
  degraded to the fuzzy result; fix that row to the new target or delete it.

## Responsive & verify

- **Responsive by default** — root is `w-full`, never the artboard's fixed width; ground breakpoints
  from the file's other-width frames. → [`references/responsive.md`](./references/responsive.md).
- **Verify visually before you call it done** — render with the project's toolchain, screenshot at the
  design's viewport, diff against the Figma node, fix at the source.
  → [`references/verify.md`](./references/verify.md).

## Motion (animation)

When `get_design_context` (full detail) tags a node with a `motion` summary — applied
animation-style presets, animated property fields, a timeline duration — carry it into the project's
animation mechanism (CSS `@keyframes` / `transition`, Framer Motion, GSAP, Vue `<transition>`) instead
of emitting a static component. `get_node_motion` returns the full keyframe detail when the summary
isn't enough. Dropping a frame's animation is a fidelity miss, the same class as dropping a shadow.
→ [`references/motion.md`](./references/motion.md).

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
- **Spell class names in full; don't assemble them from `&`.** In a language whose `&` concatenates
  (SCSS / Sass / Less / Stylus / postcss-nested) `.card { &__title {} }` compiles to
  `.card__title` — a name that exists only after
  compilation, so the class the markup carries appears nowhere in the source and adjusting one rule
  means searching a fragment like `__title` and reading every hit. Declare it flat at the top level
  instead. `profile.styling.classNaming` (on `component_map` / `token_map`) reports the project's own
  habit and **the project wins**: `ampersand` → write `&__title`; `flat` or absent → write flat.
  → [`references/stylesheets.md`](./references/stylesheets.md) for the descendant-selector trap that
  looks like the fix and isn't, and what `&` is still the right tool for.
- **Render and verify before you call it done.** (See `references/verify.md`.)
- Never write a config file or wizard prompt; everything is inferred from the project + the tools.
