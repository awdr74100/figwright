# Grounding: reading `get_design_context` + per-node fidelity

Loaded by **figma-codegen step 1**. `get_design_context` (detail `full`, `dedupeComponents: true`)
is the layout + binding source of truth — tokens resolved to names, styles deduped into `globalVars`,
each instance's `mainComponent` / `componentProperties`. Trust it over the screenshot; never
hand-resolve variable ids or read raw hex. This file is the detail: how to read the tree, the
per-property fidelity catalog, and how to ground a page too big for one call.

## Reading the tree

- **Keep `dedupeComponents: true`, and do not depth-limit a tree you intend to build from.** Dedupe
  shows the **first** instance of each repeated component in full and collapses the rest to a
  `"deduped": true` stub — a 100-instance screen stays readable while every distinct component keeps
  one complete copy. A `deduped` (or `truncated`) sibling means "identical to the first one, reuse
  that structure"; a depth cap, by contrast, throws the structure away — the trap that makes repeated
  rows/cards look empty.
- **Same structure, different content: read each deduped instance's `textOverrides`.** A `deduped`
  stub carries its own `textOverrides` (`{ name, characters }` for every visible TEXT it renders) —
  fill each repeated element's text from that, so cards/rows/form-fields get their distinct titles /
  labels / values without re-expanding the un-deduped tree or drilling per instance.

## Per-node visual fidelity

Each node exposes more than layout — translate **every** property to the stack's equivalent, not just
the obvious ones. These are ordered by how easily they're silently dropped.

- **Effects (`effects` / `styleIds.effect`).** Drop/inner shadow or blur. **The easiest fidelity to
  lose**: they come from a _shared effect style_, so they read as one field and quietly vanish. A card
  with a shadow in Figma but flat output is the classic miss (e.g. `DROP_SHADOW 0/4/8 #0000000D` →
  `shadow-[0_4px_8px_rgba(0,0,0,0.05)]`).
- **Text / typography.** A TEXT node carries more than `characters` + font — and the rest reads as
  one quiet field each, so it vanishes and the model re-guesses it off the raster. The shared style
  attributes fold into the `textStyle` bundle in `globalVars`: `textCase` (`UPPER`/`LOWER`/`TITLE` →
  `uppercase`/`lowercase`/`capitalize` — **the characters in the tree are the original casing, so a
  dropped `UPPER` ships a lowercase button**), `textDecoration` (`UNDERLINE`/`STRIKETHROUGH` →
  `underline`/`line-through` — a link with no underline is the classic miss), `lineHeight`
  (`{unit,value}` → `leading-*`; absent = font default), and `letterSpacing` (`{unit,value}` →
  `tracking-*`; absent = 0). Per-node (inline, not in the bundle): `textAlignHorizontal`/`Vertical`
  (`CENTER`/`RIGHT`/`JUSTIFIED` → `text-center`/`text-right`/`text-justify`; absent = left/top) and
  `textTruncation: 'ENDING'` + `maxLines` (→ `line-clamp-N` / `truncate`). Each is omitted when it's
  the no-op default, so anything present is real intent — translate it, don't drop it.
- **Per-side borders.** When `strokeWeight` is `mixed`, the node carries `strokeWeights`
  `{ top, right, bottom, left }` — emit only the non-zero sides (`border-t` / `border-b` / …),
  **never a uniform `border`**. Collapsing a per-side stroke into a full border turns a table row
  divider or an underline input into a full grid.
- **Stroke alignment.** A stroke carries `strokeAlign` (`INSIDE` / `OUTSIDE` / `CENTER`). `INSIDE` is
  a plain inset `border`, but `OUTSIDE` draws _outside_ the box — emit it as an `outline` or a
  `box-shadow 0 0 0 Npx <colour>`, **never a plain `border`**, so it doesn't grow the box or shift
  its position (selection rings / focus outlines are `OUTSIDE`). `CENTER` straddles the edge (half the
  weight each side).
- **Per-corner radius.** When `cornerRadius` is `mixed`, the node carries `cornerRadii`
  `{ topLeft, topRight, bottomRight, bottomLeft }` — round only those corners (`rounded-t` /
  `rounded-tl` / …), **never a uniform radius**. A card rounded on one edge, a tab, or a chat bubble
  round only some corners; collapsing to one radius squares them off or rounds the wrong side.
- **Blend mode.** A node may carry `blendMode` (`MULTIPLY` / `SCREEN` / `OVERLAY` / …) — map it to
  `mix-blend-mode` (on the element) or `background-blend-mode` (a fill over an image). An overlay
  swatch blended onto a photo reads as the wrong flat colour if you drop it.
- **Masks.** A node with `isMask: true` clips its later siblings to its own shape (`maskType`
  `ALPHA` / `LUMINANCE` / `GEOMETRY`). **Don't render the mask layer as ordinary content** — realise
  it as the container's `overflow-hidden` + radius, a `clip-path`, or an SVG mask on the masked
  siblings, and skip emitting the mask shape itself.
- **Gradient fills.** A fill of type `GRADIENT_LINEAR` / `GRADIENT_RADIAL` / `GRADIENT_ANGULAR` /
  `GRADIENT_DIAMOND` carries `gradientStops` (`{ position 0–1, color hex }`) and `gradientTransform`
  (the 2×3 axis matrix). **Emit a real CSS gradient — don't flatten it to a solid colour.** Map the
  stops directly (`linear-gradient(<angle>, #A 0%, #B 100%)`, `radial-gradient(...)`); derive the
  direction from `gradientTransform` (top→bottom linear is the common case) and confirm it in verify.
- **Image fit.** An `IMAGE` (or `VIDEO`) fill carries `scaleMode` — the object-fit equivalent:
  `FILL` → `object-cover`, `FIT` → `object-contain`, `CROP` → `cover` + a position, `TILE` →
  `background-repeat: repeat`. Apply it to the exported image so it isn't stretched or letterboxed.
- **Auto-layout & Grid — read spacing off `layout`, never eyeball it.** Each auto-layout frame carries
  a `layout` object with the _exact_ spacing; don't reverse-engineer padding/gap/justify from child
  `x/y/w/h`. `mode` `HORIZONTAL`/`VERTICAL` → `flex-row`/`flex-col`; `padding*` → `p-*`; for H/V
  `itemSpacing` → `gap`, `primaryAxisAlignItems`/`counterAxisAlignItems` → `justify-*`/`items-*`
  (`SPACE_BETWEEN` → `justify-between`). `mode: 'GRID'` → `display:grid` with
  `gridRowCount`/`gridColumnCount` → `grid-template-rows`/`grid-template-columns: repeat(N, 1fr)`,
  `gridRowGap`/`gridColumnGap` → `gap`, and optional `gridRowSizes`/`gridColumnSizes` tracks
  (`FIXED`→px, `FLEX`→fr) — **emit a real CSS grid, don't flatten it to stacked flex**. A grid child
  carries `gridChild` only when it's pinned or spanning (`rowAnchorIndex`/`columnAnchorIndex` →
  `grid-row`/`grid-column` anchor+1, `rowSpan`/`columnSpan` → span N, `horizontalAlign`/
  `verticalAlign` → `justify-self`/`align-self`); a child with **no** `gridChild` is auto-flowed — let
  the grid place it. A node's own `layoutSizingHorizontal`/`Vertical` (`FILL`→`flex-1`/stretch,
  `HUG`→fit-content, `FIXED`→explicit) + `layoutGrow` + `layoutAlign` decide how it fills its parent.
  A `FIXED` size is real intent, not the measured content size — emit it, don't let the element
  collapse to its content (e.g. a shadcn `Button` defaults to content width; a `FIXED` 220px button
  needs the width pinned or it comes out too narrow). **But on a control that would otherwise hug its
  content — a button/badge/chip/tag (auto-layout + a `FILL`/`layoutGrow` text child) whose `FIXED`
  width exceeds its content — prefer `min-w-*` over a hard `w-*`**: Figma has no native min-width, so a
  designer expresses "at least this wide, but let longer/i18n text grow" as `FIXED`. Reserve a hard
  `w-*` for things that are genuinely a fixed size (sidebars, fixed cards, avatars).

## Large designs: build section by section, and ground every section

A full page can be too big to ground in one shot — a dense whole-page tree can exceed the context
window (a single ~330-node frame can blow the token cap). When that happens, **do not retry the same
oversized call** (a dead loop, not progress), and **do not depth-cap the whole page** (a shallow tree
throws away the structure inside each section → empty cards/rows). Scope **horizontally** instead:

1. Get the page's **top-level section node ids** cheaply first — `get_design_context` at
   `detail: minimal` (and/or a small `depth`) just to see the section list, or `get_design_context` on
   the page and read the direct children.
2. Then `get_design_context` **each section by its `nodeId` at full detail** (`dedupeComponents: true`),
   build that section, and move on. One section in context at a time.

**Ground every section the same way — never eyeball values off the screenshot for "the easy ones".**
This is the cardinal failure: grounding the first sections properly, then guessing the rest to save
effort. It produces a cascade of systematic errors — heading font-sizes all guessed too small, an
accent bar the wrong colour, paddings off, a missing border — **even though `get_design_context` had
every correct value the whole time**. The screenshot is for visual intent (the rough look), never for
values. If you're about to type a px size, colour, font-size, radius, or spacing you did **not** read
from grounding, stop and `get_design_context` that node.
