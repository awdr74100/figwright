# Write rules: tokens, layout, sizing

The cross-cutting rules every build follows — whether you're assembling a screen from existing
components or authoring a new asset. These mirror codegen's "reference tokens, not literals" rules,
pointed at the canvas.

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
  (it looks right, then breaks the moment content changes).

## Sizing: append first, then fill / hug

A child can only fill or hug **once it's inside an auto-layout parent** — append it first, _then_ size
it. **There is no FILL/HUG enum on the write side**; you express it through `set_layout_props`:

- `layoutGrow: 1` → fill the **primary** axis (the layout's direction).
- `layoutAlign: 'STRETCH'` → fill the **counter** axis.
- `layoutGrow: 0` → hug.

This is the write-side inverse of the `layoutSizingHorizontal/Vertical` (`FILL` / `HUG` / `FIXED`)
that codegen reads.

## Text uses a real font, not the fallback

A new `TEXT` node defaults to a **fallback font (Inter)**, not the design system's font. Set the real
family/style with `set_text_properties` after creating it (the plugin loads the node's fonts on
edit). In a file whose typography is driven by `STRING` variables (a `font family` / `weight` token),
read those off `get_variable_defs` and apply the same family — don't leave headings in Inter.
