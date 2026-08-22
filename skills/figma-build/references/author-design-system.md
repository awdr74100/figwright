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
4. **`set_variable_code_syntax`** (`variableId`, `codeSyntax: { WEB: "--color-primary" }`) — when
   the variable comes **from an existing code token** (a CSS custom property, a Tailwind theme key),
   declare that source name here. It closes the round-trip: future codegen reads it back as the
   authoritative name (`codeSyntax` on the resolved token) instead of re-deriving one from the
   Figma name. Skip it for tokens that have no code-side counterpart yet.

Then **bind** the new variable the same way you'd bind an existing one — colour via
`bind_variable_to_paint`, scalars via `bind_variable_to_node` (see `write-rules.md`).

**Known limits (grounded, expected — not bugs):**

- **No scope control.** `create_variable` has no `scopes` parameter, so a new variable defaults to
  _all scopes_ (it shows up everywhere in the picker). Codegen doesn't read scopes, so this is a
  picker-UX nicety, not a correctness issue — note it if the user wanted a scoped token.
- **Modes are plan-gated.** `add_variable_mode` (e.g. a `Dark` mode) fails with
  `Limited to 1 modes only` on free/Starter files — the tool is faithfully surfacing Figma's plan
  limit. Don't stop at the error: fall back to a **paired collection** — create a second collection
  named for the theme (e.g. `Color/Dark`) holding the **same variable names** with that theme's
  values, and tell the user why (the same-name pairing is what `figma-codegen` recognises as a
  theme axis when reading the file back). Native multi-mode theming needs a paid plan.

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
- **Editing an existing style** (the design system already has it, and code changed its value): use
  `update_paint_style` / `update_text_style` / `update_effect_style` (`styleId` + only the fields that
  changed; omitted fields stay as-is) — **don't** `create_*` a second style with the same name, which
  leaves a duplicate. Re-syncing a style ramp from code is the common case; `get_styles` gives you the
  `styleId`s to target.
- **A value the style binds to a variable is a reference, not a literal.** `get_styles` reports those
  bindings as `boundVariables` (`{ field: variableId }`) on the paint / effect / layout grid that
  owns them — and on the text style itself for typography — with `variables` naming each id. Paints
  and effects **replace wholesale**, so an `update_*` that omits `boundVariables` replaces the
  reference with a frozen copy and the style silently stops tracking its token. Carry the binding
  through: send the paint/effect back **with** its `boundVariables`. And when what actually changed
  is the token's value, change the **variable** (`set_variable_value`) rather than the style.

Apply a style to a node with `apply_style_to_node` (`field`: fill / stroke / effect / grid / text).
Prefer a **variable** for a single colour/scalar token and a **style** for a reusable multi-property
look (a shadow, a type ramp step). The two compose rather than compete: a style's own values can be
**bound to variables**, which is how a shadow tracks a colour token or a grid tracks a spacing one.
Bind by including `boundVariables` (`{ field: variableId }`) on the paint / effect / layout grid you
pass to `create_*` / `update_*` / `set_fills` / `set_strokes` / `set_effects` / `set_layout_grids` —
`color` on a SOLID paint or a gradient stop, `color` / `radius` / `spread` / `offsetX` / `offsetY`
on a shadow, `sectionSize` / `count` / `offset` / `gutterSize` on a grid. A binding whose variable
id does not resolve is an error, not a silent miss, so a stale id fails loudly instead of painting
the value white.

A **text style** binds the same way, on `create_text_style` / `update_text_style` — `fontSize`,
`lineHeight`, `letterSpacing`, `paragraphSpacing` and `paragraphIndent` to a FLOAT variable,
`fontFamily` / `fontStyle` to a STRING one — which is how a type ramp step tracks the size and
weight tokens instead of restating them. Two differences from the paints and effects above, both
because a text style write is a **patch** rather than a whole-array replacement: omitting a field
leaves it as it was (it does not unbind), so pass `null` to unbind one; and a bound field wins over
a literal passed for that same field in the same call, so send one or the other, not both.

## Components & variant sets

1. **`create_component`** — a reusable main component (size/name/position). Build its internals like
   any frame (auto-layout, children, bound tokens — see `assemble-screens.md`). To promote something
   you already built or imported — a laid-out frame, or the vectors from an `import_svg` logo/icon —
   pass **`fromNodeId`** to convert that node into a component in place (keeps its parent/position
   unless `parentId` is given), then `create_instance` it to reuse it. That's the SVG-to-reusable-icon
   path: `import_svg` → `create_component fromNodeId` → `create_instance`.
2. **Name each variant member with `Prop=Value` syntax _before_ combining** — `Size=Small`,
   `Size=Large`. The set derives its variant properties from these names.
3. **`combine_as_variants`** (`nodeIds`: ≥2 COMPONENTs, optional `name`) → a `COMPONENT_SET`. Read it
   back (`get_node`) to confirm the property was derived (each child keeps its `Prop=Value` name under
   the set).

**Non-variant properties** (a real DS component usually needs these too — an optional icon, editable
label text, a swappable nested icon) are authored separately from variants, and each is a **declare +
bind** pair:

1. **`add_component_property`** (`componentId`, `name`, `type`, `defaultValue`) → declares a `BOOLEAN`
   (show/hide), `TEXT` (editable string), or `INSTANCE_SWAP` (swappable instance) property. Returns a
   `propertyId` (`Show Icon#4:2`). The property is **inert on its own** — declaring is only half.
2. **`bind_component_property`** (`nodeId`, `field`, `propertyId`) attaches it to the sublayer it
   drives: `visible` for a BOOLEAN, `characters` for a TEXT node, `mainComponent` for an INSTANCE.
   Bind the same property to several layers by calling once per layer (one BOOLEAN hiding a whole
   group). **A declared-but-unbound property controls nothing** — always bind, then `get_component_api`
   to confirm the property and its default read back.
3. **`edit_component_property`** renames / re-defaults (returns a new `propertyId` on rename);
   **`delete_component_property`** removes it. VARIANT properties stay the domain of `combine_as_variants`.

Once authored, switch back to the reuse path: `create_instance` the new component, bind the new
tokens, and assemble (see `assemble-screens.md`).
