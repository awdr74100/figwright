# Write rules: tokens, layout, sizing

The cross-cutting rules every build follows — whether you're assembling a screen from existing
components or authoring a new asset. These mirror codegen's "reference tokens, not literals" rules,
pointed at the canvas.

## Where every value comes from (ground, don't invent)

The top cause of an off-looking build is **invented values** — padding, sizes, radii, colours, type
the model made up. Every value should trace to a source. In priority order:

1. **The file's design system** (highest) — a variable / style / component already in the file. Reuse
   and bind it (see below). `get_variable_defs` / `get_styles` / `scan_components` say what exists.
2. **The source code / spec you were handed** — when building _from code_, the code already carries
   exact values; read them off instead of re-deriving by eye. This is the mirror of codegen (which
   reads exact values _out of_ Figma): building from code reads them _out of the code_. Be
   **provider-first** — resolve whatever styling system the code actually uses to its real px / hex;
   don't assume one. Resolve each value by its kind:
   - **Literal** (vanilla CSS, inline styles, CSS-in-JS, compiled SCSS) → read the px / hex / rem
     straight off (`1rem`=16px unless the project says otherwise).
   - **Encoded / scaled** (utility classes, component-library props, named tokens — `p-4`,
     `<Box p={4}>`, `var(--space-md)`) → don't eyeball; resolve the same three ways every time:
     **(a)** spot which system it is, **(b)** find that system's value definition — its
     config / theme / variables file, falling back to the system's documented default scale only when
     the project doesn't override it, **(c)** look the token up there. The step is identical across
     systems; only _where the scale lives_ and _the token syntax_ differ — e.g. Tailwind `p-4` (its
     spacing scale) · Chakra `p={4}` (`theme.space[4]`) · MUI `sx={{ p: 2 }}` (`spacing(2)`, 8px
     base) · SCSS `$space-md` (`_variables.scss`) · CSS `var(--space-md)` (its `:root` value) · plain
     `padding: 16px` (literal). Don't hardcode a default you assumed — find the project's own
     definition first.

     For reference, **Tailwind's defaults** (the most common system): spacing
     `1/2/3/4/6/8/12/16`=`4/8/12/16/24/32/48/64`px (`p-4`=16, `gap-6`=24), radius
     `rounded-sm/-/-md/-lg/-xl/-2xl`=`2/4/6/8/12/16`px, text `sm/base/lg/xl/2xl/3xl`=
     `14/16/18/20/24/30`px, `font-medium/semibold/bold`=`500/600/700`, colour tokens→hex
     (`slate-900`=#0F172A…).

   - **Named design tokens** (CSS custom properties like `--space-md`, a theme object) → map each to
     the matching Figma variable (source 1) if one exists, else resolve to its literal value.

   Don't swap `p-6` for a guessed 32 — resolve it (Tailwind default: 24).

3. **A sensible scale** (only when neither applies — a vague description into an empty file) — pick
   from a consistent scale, never one-off numbers:
   - Spacing / padding / gap: the 8pt grid — `4, 8, 12, 16, 24, 32, 48, 64`.
   - Type: `12, 14, 16, 20, 24, 32, 40` with a clear hierarchy (don't size every text differently).
   - Radius: one of `4, 8, 12, 16`, consistent across siblings.
   - Colour: a neutral ramp (background / surface / border / muted text / ink) + one accent — not a
     fresh random hex per element.

   Reuse the _same_ value for the same role across the design — repetition is what reads as
   "designed". And prefer HUG/FILL sizing (below) so the layout computes sizes for you: the fewer raw
   width/height numbers you invent, the fewer chances to get them wrong.

### A colour from code is sRGB: say so when you write it

Figma stores every colour in the file's own colour space, and a **Display P3** file
(`get_metadata` → `colorProfile: "DISPLAY_P3"`) holds P3 channels. A CSS hex, `rgb()` or design
token is sRGB, so written as raw r/g/b into a P3 file it paints a visibly more saturated colour than
the code renders (measured: `#CC6633` written raw came out 20/255 off; with its space named, 1/255).
So every colour you take from code carries `space: "SRGB"` next to its r/g/b — on `set_fills` /
`set_strokes` / `set_text_range` paints and their gradient stops, `set_effects` shadows, paint and
effect styles, and `set_variable_value` colours. In an sRGB file it changes nothing, so add it
whenever the colour came from code, without checking the profile first. Leave it off a colour you
read from Figma and are writing back: reads already report the file's own channels. `import_svg`
handles its markup's colours itself; a motion keyframe colour takes no `space` and is document
channels.

### A shadow or blur from code: scale its radius

A Figma effect radius is not a CSS length. Measured against Figma's own renders, Figma draws a blur
of radius `r` the way CSS draws `blur(r × 0.43)`, and a shadow of radius `r` the way `box-shadow`
draws a blur of `r × 0.85`. So a value read off code converts the other way: `filter: blur(4px)` or
`backdrop-filter: blur(4px)` is `set_effects` radius `4 ÷ 0.43 ≈ 9.3`, and a `box-shadow` blur of
`8px` is radius `8 ÷ 0.85 ≈ 9.4`; offsets and spread go across as they are. Copying the CSS number
straight in paints a blur about half as strong as the code's. A `box-shadow` needs nothing else:
`set_effects` writes a drop shadow with `showShadowBehindNode: false`, which is what CSS draws (the
shadow stays outside a translucent box), unless you pass `true`.

## Reference tokens, not literals

Never hardcode a hex/px when the file has a token for it (`get_variable_defs` tells you what does).
Set the value, then bind it — there are **three** binding paths by what's being bound:

- **Colour (fill / stroke) → `bind_variable_to_paint`** (`target`: `fills` / `strokes`, `index`,
  `variableId`). Set the paint first (`set_fills` / `set_strokes`), _then_ bind. Figma stores colour
  bindings on the **paint**, not the node — so `bind_variable_to_node` rejects `fills`/`strokes` and
  points you here. Pass `variableId: null` to unbind.
- **Scalars → `bind_variable_to_node`** (`field`, `variableId`): width / height / `padding*` /
  `itemSpacing`, per-corner radius (`topLeftRadius` …), `characters`, etc. The variable's type must
  match the field (a `FLOAT` for a size, a `STRING` for characters). `variableId: null` unbinds.
- **Shared styles → `apply_style_to_node`** (`field`: fill / stroke / effect / grid / text): a
  reusable multi-property look (a shadow, a type-ramp step) that lives as a style rather than a single
  variable.

### Theme variants: switch the mode, don't repaint

When the file's collections have modes (Light / Dark, a brand, a language — `get_variable_defs`
lists them per collection) and the source has a variant of a screen in another mode, build it once
with bound tokens, then `clone_node` it and `set_node_variable_mode` the copy to that mode. Every
bound variable then resolves in the new mode by itself. Re-filling the copy with that mode's hex
values gives a screen that looks right but no longer follows the tokens; and a node built from
literals cannot switch at all, which is one more reason to bind. `modeId: null` lets a node inherit
its parent's mode again.

### Tokens from a published library

`get_variable_defs` and `get_styles` list the file's own definitions only. A file built on a team
library uses the library's variables and styles, and a binding tool can only take one once it has been
imported into this file — a library item's key, or its id in the library file, is not an id here.

1. Ask the user to open the library's source file in Figma as well; the plugin connects to it like any
   other file, and `list_files` then names both.
2. `use_file` the library file. `get_variable_defs` / `get_styles` there give each token's `key`.
3. `use_file` the file you are building in. `import_variable({ variableKey })` /
   `import_style({ styleKey })` each token you will use, then bind or apply the `variableId` / `styleId`
   it returns — never the library file's own id.
4. Import before any `batch`: an import cannot be rolled back, so `batch` refuses it. If an import times
   out while the file sits in a background tab, bring it to the front and retry.

Library components need no import step: `create_instance` takes their `componentKey`, which
`get_local_components` in the library file reports.

## Style in the create call

`create_frame` / `create_rectangle` / `create_ellipse` / `create_text` accept the styling you would
otherwise do next: `fills`, `strokes` (+ `strokeWeight`, `strokeAlign`), `cornerRadius`,
`layoutSizingHorizontal` / `layoutSizingVertical`; a frame also takes `autoLayout` (the whole
`set_auto_layout` object) and `clipsContent`, and text takes the `set_text_properties` fields. They
run through the same handlers as the `set_*` tools, in a fixed order (fills, strokes, radius, auto
layout, then sizing — HUG needs the layout on, FILL needs the parent), after the node is placed. If
any step is refused the new layer is removed and the error names the step, so a failed create leaves
nothing half-styled. Bind variables afterwards (`bind_variable_to_paint` / `bind_variable_to_node`):
the inline values are literals.

## Auto-layout for related children, absolute only for placement

- **Use auto-layout whenever children have a structural relationship** (stacked, side-by-side,
  gapped). `create_frame`, then `set_auto_layout` (`HORIZONTAL` / `VERTICAL` / `GRID`) with
  padding / itemSpacing / alignment. This is how the design stays responsive and matches how codegen
  reads it back (`flex` / `grid`).
- **A CSS grid of repeated items flows; only explicit placement is `MANUAL`.** `grid-cols-3` over a
  list (cards, a gallery, a `.map()`) is `GRID` with `gridColumnCount`, `gridItemsPositioning:
  'ROW_AUTO_FLOW'` and `gridAutoTracks: 'ROWS'` (no `gridRowCount` — Figma owns it then), so the Figma
  grid re-flows when an item is added or removed and codegen reads it back as a list, not as one
  pinned cell per item. Keep the default `MANUAL` only when the code places items itself
  (`grid-row` / `grid-column` / `grid-template-areas`). A grid that was born flowing cannot be
  switched to `MANUAL` — its children never held a cell, and the tool refuses rather than strand them.
- **Absolute `x`/`y` is only for where a top-level container sits on the canvas** — never to position
  children that belong in a layout. Hand-placing laid-out children is the cardinal write miss
  (it looks right, then breaks the moment content changes). Set those exact coordinates with
  `set_position` — for a top-level frame, or for an overlay / badge after
  `layoutPositioning: 'ABSOLUTE'` (prefer `set_position` over a `move_nodes` delta that first needs
  the current x/y read back).
- **Responsive column scaffold → `set_layout_grids`, not `set_auto_layout`.** These are orthogonal:
  `set_auto_layout` arranges a frame's _children_ (flex/grid); `set_layout_grids` overlays the frame's
  own **layout grid** — the `COLUMNS` grid (a 12-col system: `count` + `gutterSize` + `alignment`) or a
  `GRID` baseline (`sectionSize`, e.g. 8pt) a designer aligns content to. When you're reproducing a
  page that has an explicit column system (the input code's container `grid-cols-12` / max-width +
  gutters), set it as a real layout grid so it round-trips and codegen reads the breakpoint structure
  back. Pass `[]` to clear.

## Centering and alignment: CSS → Figma recipes

Centering is a property of the layout, so pick the recipe by what the source CSS does — never by
nudging `x`/`y` until it looks centred. `align_nodes` is for what has no layout to lean on.

| Source CSS                                                         | Figma                                                                                                                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `display:flex; justify-content:center`                             | `set_auto_layout` `primaryAxisAlignItems: 'CENTER'`                                                                          |
| `align-items:center`                                               | `set_auto_layout` `counterAxisAlignItems: 'CENTER'`                                                                          |
| `justify-content:center; align-items:center` (true centre)         | both of the above on the same frame                                                                                          |
| one child centred in a column/row (`align-self:center`, `mx-auto`) | `set_layout_props` `layoutAlign: 'CENTER'` on that child (hug it first, so there is room to centre in)                       |
| `justify-content:space-between / space-around / space-evenly`      | `primaryAxisAlignItems: 'SPACE_BETWEEN' / 'SPACE_AROUND' / 'SPACE_EVENLY'`                                                   |
| `text-align: center / right / justify`                             | `set_text_properties` `textAlignHorizontal: 'CENTER' / 'RIGHT' / 'JUSTIFIED'`                                                |
| text centred vertically in a fixed-height box                      | `set_text_properties` `textAlignVertical: 'CENTER'` (only shows in a fixed-height box)                                       |
| evenly spaced row of absolute items                                | `align_nodes` `distribute: 'HORIZONTAL'` (3+ nodes; outer two stay put)                                                      |
| `align-items:baseline`                                             | `counterAxisAlignItems: 'BASELINE'`                                                                                          |
| `place-items:center` on a grid                                     | centre each cell's child with `layoutAlign: 'CENTER'`; the GRID frame itself has no item alignment                           |
| `position:absolute; inset:0; margin:auto` (overlay)                | `layoutPositioning: 'ABSOLUTE'`, then `align_nodes` `horizontal: 'CENTER', vertical: 'CENTER'`                               |
| centred in a plain (non-auto-layout) frame                         | `align_nodes` (default `relativeTo: 'PARENT'`); add `set_constraints` `CENTER` only for how it follows a later parent resize |

Rules that keep this right:

- **Centre with the parent's alignment, not coordinates.** If you are computing `x`/`y` for something
  that sits in a flow, the structure is wrong — fix the layout. Where there is no flow to lean on
  (absolute overlays, free-placed items) use `align_nodes`, never hand arithmetic with `set_position`.
- **Hug before centring.** A child set to `FILL` on the axis you want to centre on has no slack, so it
  looks left-aligned. `HUG` it, then centre.
- **`align_nodes` uses the node's on-canvas bounding box,** so a rotated or `HUG` node is centred by
  what it really measures. It refuses an in-flow auto-layout child (the layout would reflow it back) and
  moves nothing when it refuses; a node directly on a page needs `relativeTo: 'SELECTION'`.
- **A node that must be centred inside an auto-layout sibling-flow** (one pinned centre element in a
  row of others) is the one place to go ABSOLUTE; everything else stays in flow.
- **`set_constraints` is not a "centre now" command.** It records how a node reacts when its parent
  resizes. It does not move anything, and plain frames only.

### Text alignment

`set_text_properties` takes `textAlignHorizontal` (`LEFT` / `CENTER` / `RIGHT` / `JUSTIFIED`) and
`textAlignVertical` (`TOP` / `CENTER` / `BOTTOM`). Horizontal alignment needs a box wider than the
longest line — a `HUG`-width text has nothing to align within, so give a centred paragraph a `FILL` or
fixed width. Vertical alignment only shows in a box taller than its text (fixed height).

### Shapes

`create_shape` makes a `LINE` (its `width` is its length; style with `set_strokes`, tilt with
`rotate_nodes`), a `POLYGON` (`pointCount` sides) or a `STAR` (`pointCount`, `innerRadius` 0–1).
Combine shapes with `boolean_operation` (`UNION` / `SUBTRACT` / `INTERSECT` / `EXCLUDE`; the operands
must share a parent; `SUBTRACT` cuts the upper layers out of the lowest) and bake the result into one
editable path with `flatten_nodes` only when the artwork is final — flattening turns text into
outlines. Neither runs inside a `batch`. A divider is a rectangle's bottom stroke or a `LINE`, never a
1px-tall filled rectangle.

### Other things the tools do not have

Check this list before promising a design; for each, use the fallback or say so.

| Not available                                 | Fallback                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| freeform pen paths, editing a vector's points | draw it as SVG and `import_svg`; for a shape that is a combination, `boolean_operation` of primitives |
| a one-call styled frame                       | `create_frame`, then `set_fills` / `set_strokes` / `set_corner_radius` / `set_auto_layout`            |

## Sizing: HUG, FILL, FIXED (the same enum codegen reads)

`set_layout_props` takes `layoutSizingHorizontal` / `layoutSizingVertical` = **`HUG`** (shrink to fit
children) / **`FILL`** (stretch to fill the auto-layout parent) / **`FIXED`** (keep the current
size) — the exact `layoutSizingHorizontal/Vertical` codegen reads, now settable. Reach for these
first:

- A container (wrapper, row, card, button) should **`HUG`** so it shrinks to its content instead of
  staying a fixed **100×100** box — this is the single most common write miss. A frame created
  without an explicit `width`+`height` stays 100×100 with its counter axis FIXED until you set
  `HUG`.
- A child that should stretch fills with **`FILL`** — append it into its auto-layout parent first.
- `FIXED` keeps an explicit size (e.g. a card pinned to a column width).

`layoutGrow: 1` (primary axis) and `layoutAlign: 'STRETCH'` (counter axis) are the older per-axis
equivalents of `FILL` and still work, but prefer the `layoutSizing*` enum. Avoid `resize_nodes` for
content-driven sizing — it forces FIXED and re-introduces the 100×100 fights.

When the source code carries `min-width` / `max-width` / `min-height` / `max-height` (a `max-w-md`
card, a `min-w-[120px]` button), author them as real bounds via `set_layout_props`'s `minWidth` /
`maxWidth` / `minHeight` / `maxHeight` (px; `null` clears) instead of freezing the current size with
`FIXED` — the frame then resizes the way the CSS does, and codegen reads the same bounds back.
Bounds apply to auto-layout frames and their direct children.

## Text uses a real font, not the fallback

A new `TEXT` node defaults to a **fallback font (Inter)**, not the design system's font. Set the real
family/style with `set_text_properties` after creating it (the plugin loads the node's fonts on
edit). In a file whose typography is driven by `STRING` variables (a `font family` / `weight` token),
read those off `get_variable_defs` and apply the same family — don't leave headings in Inter.

## Inline rich text → `set_text_range`, not a separate node per span

When a single text block mixes styles — a link inside a sentence, a bold word, a coloured span, a
`/mo` after a price, a bulleted list — keep it **one `TEXT` node** and style the character ranges with
`set_text_range` (`ranges: [{ start, end, … }]`), the write-side mirror of what codegen reads back as
`segments`. **Never split an inline link/emphasis into its own sibling node** (it breaks reflow and
reads as separate text). Each range takes the same props as a read segment — `fontName` / `fills` /
`textDecoration` for emphasis (a `fontName` may carry `variationSettings` to emphasise with a
variable font's weight axis rather than a separate face), `hyperlink` for links, `listOptions` + `indentation` for real
`<ol>`/`<ul>` items — plus design-system bindings `textStyleId` / `fillStyleId` / `boundVariables`, so
the link tracks `Primary/500` rather than a one-off hex. Set the whole string first (`create_text` /
`set_text`), then style the ranges.

The same one-node rule applies to **multi-paragraph body text** (an article body, an FAQ answer,
legal copy): keep the paragraphs in one `TEXT` node separated by `\n` and set the source's
`p + p { margin }` / `text-indent` as `paragraphSpacing` / `paragraphIndent` via
`set_text_properties` — don't fake the rhythm by splitting each paragraph into its own node in an
auto-layout stack (that turns one flowing text into N boxes and reads back as unrelated nodes).
A source `text-wrap: balance` / `pretty` carries over as `textWrapStyle` on the same call (Figma uses
the CSS value names): `BALANCE` for headings and pull quotes, `PRETTY` for body copy. It is applied
per paragraph, so to vary it within one node use `set_text_range` with a range inside the paragraph
you mean — that range selects the paragraph, not the characters. A text style can carry it too
(`create_text_style` / `update_text_style`), which is the right home when every node bound to
"Heading/H1" should balance.
