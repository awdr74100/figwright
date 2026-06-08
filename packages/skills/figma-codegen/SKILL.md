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
   - **Same structure, different content: read each deduped instance's `textOverrides`.** A `deduped`
     stub carries its own `textOverrides` (`{ name, characters }` for every visible TEXT it renders) —
     fill each repeated element's text from that, so the cards/rows/form-fields get their distinct
     titles / labels / values without re-expanding the un-deduped tree or drilling per instance.
   - **Carry per-node visual properties, not just layout.** Each node also exposes `fills`, `strokes`,
     `cornerRadius`, `opacity`, and **`effects` / `styleIds.effect`** — translate every one to the
     stack's equivalent. **Effects (drop/inner shadow, blur) are the easiest fidelity to lose**: they
     come from a _shared effect style_ so they read as one field on the node and quietly vanish in
     generation. A card that has a shadow in Figma but flat output is the classic miss (e.g. a
     `DROP_SHADOW 0/4/8 #0000000D` → `shadow-[0_4px_8px_rgba(0,0,0,0.05)]`).
   - **Per-side borders.** When `strokeWeight` is `mixed`, the node carries `strokeWeights`
     `{ top, right, bottom, left }` — emit only the non-zero sides (`border-t` / `border-b` / …),
     **never a uniform `border`**. Collapsing a per-side stroke into a full border turns a table row
     divider or an underline input into a full grid (a common, easy-to-miss fidelity bug).
   - **Stroke alignment.** A stroke carries `strokeAlign` (`INSIDE` / `OUTSIDE` / `CENTER`). `INSIDE`
     is a plain inset `border`, but `OUTSIDE` draws _outside_ the box — emit it as an `outline` or a
     `box-shadow 0 0 0 Npx <colour>`, **never a plain `border`**, so it doesn't grow the box or shift
     its position (selection rings / focus outlines are `OUTSIDE`). `CENTER` straddles the edge (half
     the weight each side).
   - **Gradient fills.** A fill of type `GRADIENT_LINEAR` / `GRADIENT_RADIAL` / `GRADIENT_ANGULAR` /
     `GRADIENT_DIAMOND` carries `gradientStops` (`{ position 0–1, color hex }`) and `gradientTransform`
     (the 2×3 axis matrix). **Emit a real CSS gradient — don't flatten it to a solid colour** (the same
     class of miss as a dropped shadow). Map the stops directly (`linear-gradient(<angle>, #A 0%, #B
100%)`, `radial-gradient(...)`); derive the direction from `gradientTransform` (a top→bottom linear
     gradient is the common case) and confirm it in the render-verify step.
   - **Image fit.** An `IMAGE` (or `VIDEO`) fill carries `scaleMode` — the object-fit equivalent:
     `FILL` → `object-cover` (Tailwind) / `object-fit: cover`, `FIT` → `object-contain`, `CROP` →
     `cover` + a position, `TILE` → `background-repeat: repeat`. Apply it to the exported image so it
     isn't stretched or letterboxed.
   - **Auto-layout & Grid — read spacing off `layout`, never eyeball it.** Each auto-layout frame
     carries a `layout` object with the _exact_ spacing; don't reverse-engineer padding/gap/justify
     from child `x/y/w/h`. `mode` `HORIZONTAL`/`VERTICAL` → `flex-row`/`flex-col`; `padding*` → `p-*`;
     for H/V `itemSpacing` → `gap`, `primaryAxisAlignItems`/`counterAxisAlignItems` → `justify-*`/
     `items-*` (`SPACE_BETWEEN` → `justify-between`). `mode: 'GRID'` → `display:grid` with
     `gridRowCount`/`gridColumnCount` → `grid-template-rows`/`grid-template-columns: repeat(N, 1fr)`,
     `gridRowGap`/`gridColumnGap` → `gap`, and optional `gridRowSizes`/`gridColumnSizes` tracks
     (`FIXED`→px, `FLEX`→fr) — **emit a real CSS grid, don't flatten it to stacked flex**. A grid child
     carries `gridChild` only when it's pinned or spanning (`rowAnchorIndex`/`columnAnchorIndex` →
     `grid-row`/`grid-column` anchor+1, `rowSpan`/`columnSpan` → span N, `horizontalAlign`/
     `verticalAlign` → `justify-self`/`align-self`); a child with **no** `gridChild` is auto-flowed —
     let the grid place it, don't emit an explicit `grid-row`/`grid-column`. A node's own
     `layoutSizingHorizontal`/`Vertical` (`FILL`→`flex-1`/
     stretch, `HUG`→fit-content, `FIXED`→explicit) + `layoutGrow` + `layoutAlign` decide how it fills
     its parent.
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
     value but call out the gap (and offer to add it to the project's token source).
4. **`get_screenshot` — export the assets the structural tools can't carry.** Geometry + text grounding
   has **no pixels**: logos, photos, and icons otherwise come out as grey blocks, which is the single
   biggest fidelity gap on real-world files (often half the visible surface). For each visual-only leaf,
   export the node instead of placeholdering or hand-typesetting it:
   - a node with an **`IMAGE` fill** (a photo/product-shot rectangle) → `get_screenshot` `PNG` (scale 2);
   - a **`VECTOR`** / boolean-op, or an **icon instance** (e.g. `mainComponent.name` under `Icons/…`, a
     small square instance) → `get_screenshot` `SVG`;
   - **logos / brand marks are always exported**, never typed by hand.
   - **An `empty: true` export rendered nothing** (node hidden / fully clipped / off-canvas — e.g. a
     marquee's off-screen edge logos). Don't ship the blank file: if grounding shows the instance has
     art, re-export its `mainComponent`; if it's genuinely empty, skip it.
   - **Import svg icons per `profile.svg`** (returned on `component_map` / `token_map`):
     - `mode: 'component'` — a loader (svgr / vite-svg-loader / …) is set up; `profile.svg.importHint`
       gives the **exact** import form, which differs by loader (`?react` vs `?component` vs
       `{ ReactComponent }`). Import once and render `<Icon/>`, **reusing the same import across every
       occurrence** (dedupe: one file, one import, many uses).
     - `mode: 'url'` — no loader; `import url from './icon.svg'` + `<img src>`, or inline the svg when
       you need `currentColor` / CSS control. **Never emit `<Icon/>` in url mode** — that import won't run.

     Save under the project's asset dir (`src/assets`, `public/…`) and wire the real file in. This is the
     one place you go to the image — not to guess layout, but to fetch a pixel asset grounding can't encode.

Then emit code in the detected stack (the profile comes back on `component_map` / `token_map`; you do
not call `analyze_project` yourself). Compose the reused components, wrap unmapped pieces, and apply
token references for color/spacing/radius/typography.

## Large designs: build section by section, and ground every section

A full page can be too big to ground in one shot — a dense whole-page tree can exceed the context
window (a single ~330-node frame can blow the tool's token cap). When that happens, **do not retry the
same oversized call** (that's a dead loop, not progress), and **do not depth-cap the whole page** (a
shallow tree throws away the structure inside each section → empty cards/rows). Scope **horizontally**
instead:

1. Get the page's **top-level section node ids** cheaply first — `get_design_context` at `detail: minimal`
   (and/or a small `depth`) just to see the list of sections, or `get_design_context` on the page and
   read the direct children.
2. Then `get_design_context` **each section by its `nodeId` at full detail** (`dedupeComponents: true`),
   build that section, and move to the next. One section in context at a time.

**Ground every section the same way — never eyeball values off the screenshot for "the easy ones".**
This is the cardinal failure: grounding the first sections properly, then guessing the rest from the
screenshot to save effort. It produces a cascade of systematic errors — heading font-sizes all guessed
too small, an accent bar the wrong colour, paddings off, a missing border — **even though
`get_design_context` had every correct value the whole time**. The screenshot is for visual intent (the
rough look), never for values. If you're about to type a px size, a colour, a font-size, a radius, or a
spacing you did **not** read from grounding, stop and `get_design_context` that node. The plugin already
gave you the exact number; use it.

## Responsive by default

Real designs ship multiple breakpoints and modern output is expected to be responsive — so **never
hardcode the artboard width** (a root `w-[1920px]` scrolls on every smaller screen). The root is
`w-full`; sections stay fluid with content centered in a `max-w`. Ground the breakpoints instead of
guessing them:

1. **Find the other breakpoints.** `search_nodes` (type `FRAME`, scoped to the file/page) lists
   sibling frames with widths. Match the desktop frame to its narrower counterparts by **width
   buckets** (~1920/1440 desktop · ~768 tablet · ~375 mobile), **name normalization** (strip device
   prefixes — `W_`/`Ｍ_`, `Desktop`/`Mobile`, `PC`/`SP`), and **content similarity** (same section
   order + matching `textOverrides` text — works even with no naming convention). `get_design_context`
   each matched frame.
2. **Diff into one mobile-first base + `lg:`/`xl:` variants.** Most differences are **reflow** — a
   single markup with utilities (`flex-col lg:flex-row`, `grid-cols-1 xl:grid-cols-3`, `hidden
xl:block`, alignment swaps). Only a **structure swap** needs twin `xl:hidden` / `hidden xl:block`
   markup: when the content _semantics_ differ (a CTA `登入` on mobile vs `聯絡我們` on desktop) or
   the layout systems are incompatible (hamburger vs full nav, an absolute hero vs a flow stack).
3. **A fixed-width desktop layout's breakpoint must be ≥ its content width** — gate a 1180px row at
   `xl:`/1280, not `lg:`/1024, or it overflows at in-between sizes; below it, fall back to the stack.

No other-breakpoint frame? Still output best-effort RWD (fluid container + sensible reflow) and note
the responsive behaviour is inferred, not grounded.

## Verify visually (close the loop)

Generated code that you never render is unverified. Don't ship it on faith — **render it with the
project's own toolchain, screenshot it, compare against the Figma node, and fix the diff.** This is the
self-correcting step: it catches exactly the fidelity misses the grounding tools warn about (dropped
shadows, uniform-vs-per-side borders, wrong font sizes, missing assets, full-bleed gutters, broken
reflow) — things that only show up once pixels exist.

There is **no generic "verify" tool**, and there shouldn't be: the render entry is project-specific
(dev server vs build+preview, the port, the route, how a single component is mounted, what props/data
it needs, the runtime context). You have the project context + a shell + a browser — so drive it
yourself, per project:

1. **Render with the project's runtime.** Use what the project actually uses — e.g. Vite: `pnpm build`
   then `pnpm preview`; Next: `next build && next start`; or the existing dev server. Mount what you
   built (a page route, or a throwaway entry/harness for a single component) and make sure tokens,
   Tailwind/CSS, and exported assets are wired so the render isn't half-styled (a half-styled render
   makes the diff pure noise — that defeats the check).
2. **Screenshot at the design's real viewport.** Use Chrome headless via CDP `Emulation.setDeviceMetricsOverride`
   for an exact width — **do not trust `--window-size`** for exact-width/mobile shots (it renders wider
   than asked and crops a centered `mx-auto` root, faking a right-edge overflow). For wide desktop,
   `--headless=new --screenshot --window-size=1440,1500` is fine (cards have margin, nothing gets cut).
   Get the Figma side from `get_screenshot` on the same node.
3. **Compare and fix.** Diff the two (eyeball, or pixelmatch/odiff for a %); for each real discrepancy
   trace it back to the cause (re-`get_design_context` that node — don't re-guess from the screenshot)
   and fix the code. Re-render. Repeat until it matches.
4. **Check both breakpoints.** Re-screenshot at desktop _and_ mobile widths; confirm zero horizontal
   overflow on mobile (`document.scrollWidth === innerWidth`, allowing for intentional `overflow-x-auto`
   carousels) and that the desktop layout didn't regress.

## Rules

- **Ground every section — never eyeball a value off the screenshot.** Every px size, colour, font-size,
  radius, and spacing must come from `get_design_context`, for _every_ section, not just the first few.
  The screenshot is visual intent only. Guessing "the easy sections" to save effort is the cardinal miss
  (it caused a cascade of wrong font-sizes / colours / paddings on a real file while the exact values sat
  in the grounding the whole time). On a page too big to ground at once, scope by section `nodeId` and
  build one section at a time — never depth-cap the whole page, never retry an oversized call.
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
- **Per-side borders.** A `strokeWeight: "mixed"` node carries `strokeWeights { top, right, bottom,
left }` — emit only the non-zero sides (`border-t`/`border-b`), never a uniform `border` (that turns
  a row divider or underline input into a grid).
- **Honour `strokeAlign`.** `INSIDE` → plain inset `border`; `OUTSIDE` → `outline` or `box-shadow 0 0 0
Npx` (never a plain `border`, which grows/shifts the box — selection & focus rings are `OUTSIDE`);
  `CENTER` straddles the edge.
- **Don't flatten gradients.** A `GRADIENT_*` fill carries `gradientStops` + `gradientTransform` — emit
  a CSS `linear-gradient`/`radial-gradient` from the stops, not the first stop's solid colour. Apply an
  `IMAGE`/`VIDEO` fill's `scaleMode` as `object-fit` (FILL→cover, FIT→contain, TILE→repeat) so the
  exported image isn't stretched.
- **Ground spacing off `layout`, not geometry.** Auto-layout frames carry `layout` (`padding*` → `p-*`,
  `itemSpacing` → `gap`, `primary`/`counterAxisAlignItems` → `justify-*`/`items-*`). `mode: 'GRID'` →
  `display:grid` (`gridRow`/`ColumnCount` → `repeat(N, 1fr)`, `gridRow`/`ColumnGap` → `gap`, tracks
  FIXED→px / FLEX→fr; each child's `gridChild` anchor/span → `grid-row`/`grid-column`) — emit a real
  CSS grid, don't flatten it to flex. Never reverse-engineer padding/gap from child `x/y/w/h`.
- **Responsive by default.** Root is `w-full`, never the artboard's fixed width (it scrolls on smaller
  screens). When the file has other-breakpoint frames, find them (`search_nodes` + width/name/content
  matching) and ground the responsive behaviour from their diff — reflow with breakpoint utilities,
  twin markup only for structure swaps.
- **Full-bleed pages need a body reset — but check first.** An edge-to-edge page must zero the body
  margin (a missing reset shows as a full-page white gutter + horizontal overflow; scoped / CSS-module
  styles can't reach `html`/`body`). Don't blindly add one: Tailwind's preflight
  (`profile.styling.system === 'tailwind'`) and any existing reset/normalize already handle it. Add a
  minimal global reset **only** when the project is non-Tailwind and has none — and never duplicate one
  that's already there. Make the reset complete: zero the body margin **and** default block-element
  margins (`h1`–`h6`, `p`, `ul`, `figure`, …) + `box-sizing`. A body-only reset still leaves default
  `<p>`/heading margins that inflate every stacked text block (a footer's contact rows space out and the
  footer grows too tall).
- **Render and verify before you call it done.** Don't ship code you never rendered. Use the project's
  own toolchain to render, screenshot at the design's real viewport (CDP `setDeviceMetricsOverride` for
  exact width, **not** `--window-size`), diff against the Figma node, and fix discrepancies at their
  source — then re-render. There is no generic verify tool; the render entry is project-specific, so you
  drive it. (See "Verify visually".)
- Never write a config file or wizard prompt; everything is inferred from the project + the three tools.
- If a reused component lacks a prop the design needs (e.g. a `required` field, a password toggle), say
  so — that's a real extension the component needs, not something to fake with ad-hoc markup.
  `component_map` reports these directly as `candidate.unmatchedProps`; turn them into TODOs.
