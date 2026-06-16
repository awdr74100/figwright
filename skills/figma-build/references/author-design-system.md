# Authoring design-system assets

Loaded when the file genuinely lacks a token / style / component the source UI needs (grounding via
`get_variable_defs` / `scan_components` / `get_styles` came back empty for it). **Authoring is the
exception, not the default** — instance and bind what exists first; only build a new primitive when
the system has no equivalent, and name it to fit the system's conventions
(`color/primary`, `spacing/4`, `Heading/H1`).

## Variables (tokens)

Build the collection top-down — the collection hands you the mode id you need to set values.

1. **`create_variable_collection`** (`name`) → returns `{ collectionId, defaultModeId }`. Figma
   auto-creates one mode; **keep `defaultModeId`** — `set_variable_value` needs a `modeId`.
2. **`create_variable`** (`name`, `collectionId`, `resolvedType`: `COLOR` / `FLOAT` / `STRING` /
   `BOOLEAN`). Group with slashes in the name (`color/primary`, `space/md`) — that's the folder
   structure the picker and `get_variable_defs` show back.
3. **`set_variable_value`** (`variableId`, `modeId`, `value`) per mode. `value` shape follows the
   type: a number for `FLOAT`, a string for `STRING`, a boolean for `BOOLEAN`, `{ r, g, b, a }`
   (0–1) for `COLOR`, or `{ type: "VARIABLE_ALIAS", id }` to alias another variable (semantic token
   → primitive token).

Then **bind** the new variable the same way you'd bind an existing one — colour via
`bind_variable_to_paint`, scalars via `bind_variable_to_node` (see `write-rules.md`).

**Known limits (grounded, expected — not bugs):**

- **No scope control.** `create_variable` has no `scopes` parameter, so a new variable defaults to
  _all scopes_ (it shows up everywhere in the picker). Codegen doesn't read scopes, so this is a
  picker-UX nicety, not a correctness issue — note it if the user wanted a scoped token.
- **Modes are plan-gated.** `add_variable_mode` (e.g. a `Dark` mode) fails with
  `Limited to 1 modes only` on free/Starter files — the tool is faithfully surfacing Figma's plan
  limit. Multi-mode theming needs a paid plan.

**Cleanup:** delete a single variable with `delete_variable`, or a whole collection (and every
variable in it) with `delete_variable_collection` — remove an authoring mistake rather than leaving
an orphan collection behind.

## Styles (shared paint / text / effect / grid)

- **`create_paint_style`** (`name`, `paints`) — SOLID or gradient, same paint shape as `set_fills`.
  Slashes in the name group it (`Brand/Primary`).
- **`create_text_style`** (`name`, `fontName`, `fontSize`, `lineHeight`, `letterSpacing`) — the font
  is loaded before assignment; `lineHeight.unit` is `AUTO` / `PIXELS` / `PERCENT` (AUTO omits the
  value).
- Effect / grid styles have their own create tools.

Apply a style to a node with `apply_style_to_node` (`field`: fill / stroke / effect / grid / text).
Prefer a **variable** for a single colour/scalar token and a **style** for a reusable multi-property
look (a shadow, a type ramp step).

## Components & variant sets

1. **`create_component`** — a reusable main component (size/name/position). Build its internals like
   any frame (auto-layout, children, bound tokens — see `assemble-screens.md`).
2. **Name each variant member with `Prop=Value` syntax _before_ combining** — `Size=Small`,
   `Size=Large`. The set derives its variant properties from these names.
3. **`combine_as_variants`** (`nodeIds`: ≥2 COMPONENTs, optional `name`) → a `COMPONENT_SET`. Read it
   back (`get_node`) to confirm the property was derived (each child keeps its `Prop=Value` name under
   the set).

Once authored, switch back to the reuse path: `create_instance` the new component, bind the new
tokens, and assemble (see `assemble-screens.md`).
