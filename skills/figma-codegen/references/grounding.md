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
- **A variable's `codeSyntax` is the declared code name — prefer it over deriving one.** An entry in
  the top-level `variables` map may carry `codeSyntax` (`{ WEB: '--color-primary', … }`): the
  designer's own declaration of the code-side token, stronger than any name you'd derive from the
  Figma name (`Primary/500` → `primary-500`). Use the platform key matching the stack (WEB for
  css/Tailwind). It's a naming declaration, not a guarantee the token exists — when it matches a
  token in the project (theme file / `token_map`), use it verbatim; when it matches nothing (a stale
  declaration after a rename), trust the project's actual token found by value/name instead.

## Per-node visual fidelity

Each node exposes more than layout — translate **every** property to the stack's equivalent, not just
the obvious ones. These are ordered by how easily they're silently dropped.

- **Effects (`effects` / `styleIds.effect`).** Drop/inner shadow or blur. **The easiest fidelity to
  lose**: they come from a _shared effect style_, so they read as one field and quietly vanish. A card
  with a shadow in Figma but flat output is the classic miss (e.g. `DROP_SHADOW 0/4/8 #0000000D` →
  `shadow-[0_4px_8px_rgba(0,0,0,0.05)]`). A blur's `type` decides the CSS: `LAYER_BLUR` blurs the
  element itself (`filter: blur`), but `BACKGROUND_BLUR` blurs what shows through from behind
  (`backdrop-filter: blur` — the frosted-glass / glassmorphism pattern, typically paired with a
  semi-transparent fill); emitting it as `filter`, or dropping it, loses the glass look entirely.
- **Text / typography.** A TEXT node carries more than `characters` + font — and the rest reads as
  one quiet field each, so it vanishes and the model re-guesses it off the raster. The shared style
  attributes fold into the `textStyle` bundle in `globalVars`: `textCase` (`UPPER`/`LOWER`/`TITLE` →
  `uppercase`/`lowercase`/`capitalize` — **the characters in the tree are the original casing, so a
  dropped `UPPER` ships a lowercase button**), `textDecoration` (`UNDERLINE`/`STRIKETHROUGH` →
  `underline`/`line-through` — a link with no underline is the classic miss), `lineHeight`
  (`{unit,value}` → `leading-*`; absent = font default), `letterSpacing` (`{unit,value}` →
  `tracking-*`; absent = 0), `paragraphSpacing` (px between the paragraphs `characters` splits into
  at `\n` → margin between the `<p>`s you emit; absent = 0, the paragraphs butt together),
  `paragraphIndent` (px first-line indent → `text-indent`), and `textWrapStyle` — Figma's values are
  CSS `text-wrap`'s verbatim, so `BALANCE` → `text-wrap: balance` (even line lengths; a designer sets
  it on headings and pull quotes) and `PRETTY` → `text-wrap: pretty` (no orphan last word); absent =
  `auto`, the browser default. Per-node (inline, not in the bundle):
  `textAlignHorizontal`/`Vertical` (`CENTER`/`RIGHT`/`JUSTIFIED` → `text-center`/`text-right`/
  `text-justify`; absent = left/top), `textTruncation: 'ENDING'` + `maxLines` (→ `line-clamp-N` /
  `truncate`), and `textAutoResize` — how the text box sizes, the signal for whether its
  width/height are real constraints: absent = hug (the box is just the text's own rendered size —
  don't emit a width), `HEIGHT` = fixed width + auto height (the width is a wrap constraint — emit
  it), `NONE` = fixed box (emit both, mind clipping); inside auto-layout trust
  `layoutSizingHorizontal/Vertical` instead. Each is omitted when it's
  the no-op default, so anything present is real intent — translate it, don't drop it.
  - **`textWrapStyle` is per paragraph, not per node.** When a node's paragraphs disagree the
    node-level field is absent and the real values ride in `segments` (a run carries it only when it
    is not `auto`) — so a `segments` array whose runs differ only in `textWrapStyle` is one text
    block with per-paragraph wrapping, not inline rich text.
  - **Mixed (inline) styling → read `segments`.** When a value reads `"mixed"` (e.g. `fontSize` or
    `textDecoration`), the node carries `segments` — each a run of uniform styling with its own
    `characters`, `fontName`, `fontSize`, `fills` (hex), `textDecoration`, `textCase` over offsets
    `start`/`end` (plus per-run `lineHeight`/`letterSpacing` when they differ). These describe runs
    **within** the node's `characters` (not extra text) — emit each as its own span: the
    underlined/coloured `Privacy Policy` inside a sentence, the bold word in a label, the smaller
    `/mo` after a price. Dropping them flattens the whole string to one style (a link with no
    underline, a price with no emphasis) — the classic mixed-text miss.
  - **Inline links & lists → `segments` carry structure, not just style.** A run may carry
    `hyperlink` (`{ type: 'URL' | 'NODE', value }`) → emit an `<a href>` (or router link for a
    `NODE` target); a partial link is the reason a whole node reads mixed. A run may carry
    `listOptions` (`ORDERED` / `UNORDERED`) with an `indentation` depth → emit real `<ol>`/`<ul>`
    list items nested by depth, **not** newline-separated text with literal bullet characters. A
    node whose _whole_ text is one uniform link instead carries a node-level `hyperlink`; a fully
    uniform list still expands to a single `segment` so its `listOptions` survives.
  - **Per-run tokens → a run's `styleIds` / `boundVariables` resolve like a node's own.** A run may
    carry `styleIds` (`text` / `fill` → a shared text/fill style id) and `boundVariables` (e.g. a
    colour token on `fills`), resolved to names in the top-level `styles` / `variables` maps just
    like node-level bindings. Prefer the resolved token (the `Link/Default` text style, the
    `Primary/500` colour) over the run's raw hex — on a mixed node the node-level fill reads `mixed`,
    so a run's binding is the **only** place the inline link's colour/type token survives. Emit the
    class/variable, not a one-off hex, so the link tracks the design system.
- **Per-side borders.** When `strokeWeight` is `mixed`, the node carries `strokeWeights`
  `{ top, right, bottom, left }` — emit only the non-zero sides (`border-t` / `border-b` / …),
  **never a uniform `border`**. Collapsing a per-side stroke into a full border turns a table row
  divider or an underline input into a full grid.
- **Stroke alignment.** A stroke carries `strokeAlign` (`INSIDE` / `OUTSIDE` / `CENTER`). `INSIDE` is
  a plain inset `border`, but `OUTSIDE` draws _outside_ the box — emit it as an `outline` or a
  `box-shadow 0 0 0 Npx <colour>`, **never a plain `border`**, so it doesn't grow the box or shift
  its position (selection rings / focus outlines are `OUTSIDE`). `CENTER` straddles the edge (half the
  weight each side).
- **Dashed / dotted strokes & line ends.** A stroke may carry `dashPattern` (px on/off run lengths)
  → `border-style: dashed` (or `dotted` for short even runs), and for an SVG line/divider
  `stroke-dasharray`. Without it a dashed separator or a cut-line renders solid. A `LINE` / `VECTOR`
  stroke may also carry `strokeCap` (`ROUND` / `SQUARE`, or an arrowhead like `ARROW_LINES`) →
  `stroke-linecap` / an SVG marker, and `strokeJoin` (`ROUND` / `BEVEL`) → `stroke-linejoin`; both
  are omitted at their no-op defaults (`NONE` / `MITER`), so anything present is real intent.
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
- **Ellipse arc / ring.** An `ELLIPSE` carrying `arcData` is **not a plain circle** — a partial
  sweep (`startingAngle`→`endingAngle`, radians) is a pie slice / gauge, and `innerRadius > 0`
  (0–1 of the radius) cuts a hole for a ring / donut (a progress ring, a donut chart). Render it as
  an SVG `<path>` arc (or `<circle>` with `stroke-dasharray` for a progress ring) / a `conic-gradient`
  — **not** a filled `rounded-full` div, which loses the wedge and the hole. A full disc omits
  `arcData`, so its presence always means a real arc.
- **Gradient fills.** A fill of type `GRADIENT_LINEAR` / `GRADIENT_RADIAL` / `GRADIENT_ANGULAR` /
  `GRADIENT_DIAMOND` carries `gradientStops` (`{ position 0–1, color hex }`) and `gradientTransform`
  (the 2×3 axis matrix). **Emit a real CSS gradient — don't flatten it to a solid colour.** Map the
  stops directly (`linear-gradient(<angle>, #A 0%, #B 100%)`, `radial-gradient(...)`); derive the
  direction from `gradientTransform` (top→bottom linear is the common case) and confirm it in verify.
- **Image fit.** An `IMAGE` (or `VIDEO`) fill carries `scaleMode` — the object-fit equivalent:
  `FILL` → `object-cover`, `FIT` → `object-contain`, `CROP` → `cover` + a position, `TILE` →
  `background-repeat: repeat`. Apply it to the exported image so it isn't stretched or letterboxed.
- **Pattern fills.** A `PATTERN` fill tiles a source node (`sourceNodeId`) across the element — it is
  **not** a flat colour. Export that tile with `get_screenshot` on `sourceNodeId`, then: for
  `tileType: RECTANGULAR`, use `background-image` + `background-repeat: repeat` with a
  `background-size` derived from `scalingFactor` (and gaps from `spacing`); for the hexagonal tile
  types (`HORIZONTAL_HEXAGONAL` / `VERTICAL_HEXAGONAL`), use an SVG `<pattern>` with offset rows.
  Don't flatten it to a solid colour.
- **Containers first — the tree's nesting is the markup's nesting.** Emit **one container element per
  frame** and keep the parent/child relationships the payload gives you. Never flatten a section's
  frames into a flat run of siblings: the frame that disappears is the one that owned the `padding`
  and the `itemSpacing`, so every child then has to be placed by hand, and the result only holds at
  the design's exact width. Spacing belongs to the **container**, not to the children — `itemSpacing`
  is the parent's `gap`, `padding*` is the parent's `padding`. Never re-express either as per-child
  `margin` / `margin-top` / `margin-bottom`, and never place a child of an auto-layout frame by
  absolute offset. `margin` is only for a genuine **one-sided** offset between elements that share no
  container; where a container exists, `gap` and `padding` are the answer. The tell that this went
  wrong: sibling elements each carrying their own `margin-bottom` where the parent has one
  `itemSpacing`, or a stack of `position: absolute` children under a frame that has a `layout`.
  This holds for **every** shape the tool returns — including a degraded payload that carries layout
  without appearance (see [Large designs](#large-designs-build-section-by-section-and-ground-every-section)).
- **Auto-layout & Grid — read spacing off `layout`, never eyeball it.** Each auto-layout frame carries
  a `layout` object with the _exact_ spacing; don't reverse-engineer padding/gap/justify from child
  `x/y/w/h`. `mode` `HORIZONTAL`/`VERTICAL` → `flex-row`/`flex-col`; `padding*` → `p-*`; for H/V
  `itemSpacing` → `gap`, `primaryAxisAlignItems`/`counterAxisAlignItems` → `justify-*`/`items-*`
  (`SPACE_BETWEEN` → `justify-between`). When `layoutWrap: 'WRAP'` (a tag cloud / chip group /
  gallery) the frame also carries the cross-axis row spacing: `counterAxisSpacing` is the gap
  **between wrapped rows** (→ `flex-wrap` + the row part of `gap-x/gap-y`; with a single `gap` only
  when it equals `itemSpacing`), and `counterAxisAlignContent: 'SPACE_BETWEEN'` distributes the rows
  (`align-content: space-between`, and `counterAxisSpacing` is then absent). Don't collapse a wrapping
  flex to a single-axis `gap` — the row gap is its own value. `mode: 'GRID'` → `display:grid` with
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
  needs the width pinned or it comes out too narrow).
- **Min/max size bounds — explicit responsive constraints, never infer when present.** A node may
  carry `minWidth` / `maxWidth` / `minHeight` / `maxHeight` (auto-layout frames and their direct
  children; only set bounds appear). These are the designer's literal `min-w-* / max-w-* / min-h-* /
max-h-*` — map them directly and let the corresponding `w`/`h` stay fluid. When a node carries
  no bounds, fall back to the heuristic: **on a control that would otherwise hug its content — a
  button/badge/chip/tag (auto-layout + a `FILL`/`layoutGrow` text child) whose `FIXED` width
  exceeds its content — prefer `min-w-*` over a hard `w-*`** (designers often express "at least
  this wide, but let longer/i18n text grow" as `FIXED`). Reserve a hard `w-*` for things that are
  genuinely a fixed size (sidebars, fixed cards, avatars).
- **Layout grids — the frame's own responsive column system (don't infer breakpoints, read them).**
  A frame may carry `layoutGrids`: `COLUMNS` / `ROWS` with a `count` (e.g. 12), `gutterSize`,
  `alignment`, and `offset` (the page margin from the frame edge → container horizontal padding), or
  a uniform `GRID` with `sectionSize` (an 8px baseline). This is the designer's **explicit**
  responsive scaffold — map a `COLUMNS` grid straight to your CSS grid / container (`grid-cols-12
gap-[gutter]`, the page `max-w` + `px-[offset]`) instead of reverse-engineering column widths and
  margins from child geometry. When several breakpoint frames each carry a
  `count: 12` columns grid, that's the shared track system across breakpoints — keep the columns
  fixed and let the gutters/margins flex. A uniform `GRID` is the spacing baseline: round paddings/
  gaps to it. This is ground truth the geometry only approximates, so prefer it.
- **Scroll overflow.** A clipping frame may carry `overflowDirection` (`HORIZONTAL` / `VERTICAL` /
  `BOTH`) — the axis the content scrolls on. Emit `overflow-x-auto` / `overflow-y-auto` / `overflow-auto`
  (a horizontal card carousel, a scrollable panel), don't just clip it. Omitted (`NONE`) means no scroll.
  It may also carry `numberOfFixedChildren`: that many **leading** children stay pinned while the rest
  scroll — a `position: sticky` header/toolbar inside the scroll container, not an ordinary child.
- **Aspect ratio — a locked resize contract, not a one-off size.** A node may carry
  `targetAspectRatio` (`{ x, y }`): the width:height ratio it resizes toward (a 16:9 video box, a
  square avatar, a hero that must keep its shape across breakpoints). Emit `aspect-[x/y]` and let one
  dimension stay fluid, instead of freezing both `w` and `h` to the measured pixels.
- **Stacking & stroke space — non-default auto-layout painting.** An auto-layout frame may carry
  `itemReverseZIndex: true` (later children paint _under_ earlier ones — the overlapping-avatars /
  fanned-cards stack, usually with a negative `itemSpacing`): CSS paints later DOM nodes on top, so
  reverse it (`flex-direction: row-reverse` with reversed DOM, or explicit `z-index`) or the stack
  overlaps the wrong way. `strokesIncludedInLayout: true` means borders occupy layout space (Figma
  excludes them by default) — account for the stroke width in the gap/padding math (it's the
  `box-sizing: border-box` case). Both omitted = the defaults; nothing to do.
- **Dev Mode annotations — the designer's notes to _you_, ground truth over inference.** A node may
  carry `annotations` (`{ label, labelMarkdown, categoryId, properties }[]`): explicit developer
  instructions pinned in Dev Mode ("use the brand token here", "only visible on hover", "this is the
  live region"). Treat them as authoritative — they outrank anything you'd infer from geometry or a
  screenshot, and `properties` names the fields the note is about (e.g. `["fills"]`). Reflect the
  intent in the code (the right token, the right state, the right ARIA) and surface anything you
  can't express as a TODO rather than dropping it.
- **Absolute positioning & constraints — a node placed by coordinates, not flow.** Two
  mutually-exclusive signals say "this isn't in an auto-layout flow"; read the anchor so it survives a
  resize instead of being hardcoded to a corner.
  - **`layoutPositioning: 'ABSOLUTE'`** — an auto-layout child that opted _out_ of the flow (a badge
    pinned to a card corner, a close `×` on a modal, a floating action button). It overlaps siblings
    and takes no space: make the parent `relative` and the child `absolute`, placed from its `x`/`y`
    (offsets inside the parent) at its `width`/`height`. **Leaving it in the flex/grid flow pushes the
    siblings** — the classic miss (a corner badge that shoves the card title sideways).
  - **`constraints` `{horizontal, vertical}`** — a child of a frame that is **not** auto-layout at
    all; it's positioned by `x`/`y` and the constraint is its **resize anchor**. Map each axis to the
    edge you pin, not always top-left: horizontal `MIN`→`left`, `MAX`→`right`, `CENTER`→centered
    (`left-1/2 -translate-x-1/2`), `STRETCH`→pin both (`left-N right-M`), `SCALE`→proportional
    (`%`-based left + width); vertical `MIN`→`top`, `MAX`→`bottom`, `CENTER`→centered-y,
    `STRETCH`→`top-N bottom-M`, `SCALE`→`%`. A `MAX`/right-anchored element emitted as `left-[Xpx]`
    drifts at every width but the design's — read the constraint, don't assume the top-left corner.
  - **A frame with no `layout` is not automatically an absolute canvas.** `constraints` tells you how
    a child was _anchored_ in Figma; it does not mean the right CSS is a stack of absolutely
    positioned boxes. Many files are simply drawn without auto-layout, and emitting one `position:
absolute` per child there reproduces the artboard rather than the design: it breaks at every
    other width and is the single biggest source of unmaintainable generated markup. So read the
    geometry for **intent** before reaching for `absolute`: children in a single column at a shared
    `x` with a repeating `y` delta are a `flex-col` with that delta as `gap`; children on a shared
    `y` are a `flex-row`; a uniform inset from the parent's edges is `padding`. Emit the flow
    version, and reserve real absolute positioning for what is genuinely layered — a badge over a
    card, a caption over an image, a decorative blob. When you infer a flow this way, say so: it is
    inferred from geometry, not grounded in a `layout` object.

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

The tool enforces this on the worst cases, and it always says which shape you got in a **leading
`note`** — read that note first, it tells you what the payload is and what it is missing:

- **`sectionPlan`** (`{ sections: [{ nodeId, name, nodes }] }`) — the normal answer for a tree too
  big for one call, and **not a lesser result**: it _is_ step 1, already done. Ground each listed
  section by its `nodeId` as in step 2 and each one comes back at **full** detail, with its layout
  _and_ its colours, type and tokens — strictly more than any whole-tree view that had to drop half
  its fields to fit. A section that is itself too big returns its own plan; keep descending, it
  converges quickly (in practice two levels, onto sections of a few dozen nodes).
- **Layout without appearance** — a tree that overshot by only a little. It is intact and every
  frame still carries its `layout` (mode, `padding*`, `itemSpacing`, alignment), every node its
  sizing/`constraints`, every text its `characters`. What is gone is colour, typography, effects and
  token bindings. **Build the full structure from this** — containers, flex/grid, padding, gap —
  then `get_design_context` each section at full detail for its colours and type before styling it.
  Do **not** treat missing appearance as licence to guess it off the screenshot.
- **Layout only / structure only (compact)** — the last resorts, and only for a subtree with nothing
  to split into. Structure-only carries no `layout` at all: it is a **map, not a spec**. Use it to
  pick what to drill into, never to generate from, and in particular do not turn its `x`/`y` deltas
  into margins — the spacing they encode belongs to a `layout` you have not been given yet.

**Ground every section the same way — never eyeball values off the screenshot for "the easy ones".**
This is the cardinal failure: grounding the first sections properly, then guessing the rest to save
effort. It produces a cascade of systematic errors — heading font-sizes all guessed too small, an
accent bar the wrong colour, paddings off, a missing border — **even though `get_design_context` had
every correct value the whole time**. The screenshot is for visual intent (the rough look), never for
values. If you're about to type a px size, colour, font-size, radius, or spacing you did **not** read
from grounding, stop and `get_design_context` that node.
