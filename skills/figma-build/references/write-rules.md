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
   don't assume one. There are two kinds of value:
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

## Auto-layout for related children, absolute only for placement

- **Use auto-layout whenever children have a structural relationship** (stacked, side-by-side,
  gapped). `create_frame`, then `set_auto_layout` (`HORIZONTAL` / `VERTICAL` / `GRID`) with
  padding / itemSpacing / alignment. This is how the design stays responsive and matches how codegen
  reads it back (`flex` / `grid`).
- **Absolute `x`/`y` is only for where a top-level container sits on the canvas** — never to position
  children that belong in a layout. Hand-placing laid-out children is the cardinal write miss
  (it looks right, then breaks the moment content changes). Set those exact coordinates with
  `set_position` — for a top-level frame, or for an overlay / badge after
  `layoutPositioning: 'ABSOLUTE'` (prefer `set_position` over a `move_nodes` delta that first needs
  the current x/y read back).

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

## Text uses a real font, not the fallback

A new `TEXT` node defaults to a **fallback font (Inter)**, not the design system's font. Set the real
family/style with `set_text_properties` after creating it (the plugin loads the node's fonts on
edit). In a file whose typography is driven by `STRING` variables (a `font family` / `weight` token),
read those off `get_variable_defs` and apply the same family — don't leave headings in Inter.
