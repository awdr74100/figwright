# Assets & icons: export what grounding can't carry

Loaded by **figma-codegen step 4**. Geometry + text grounding has **no pixels**: logos, photos, and
icons otherwise come out as grey blocks — the single biggest fidelity gap on real-world files (often
half the visible surface). For each visual-only leaf, export the node instead of placeholdering or
hand-typesetting it. This is the one place you go to the image — not to guess layout, but to fetch a
pixel asset grounding can't encode.

## What to export, and how

- A node with an **`IMAGE` fill** (a photo / product-shot rectangle) → `get_screenshot` `PNG` (scale 2).
- A **`VECTOR`** / boolean-op, or an **icon instance** (e.g. `mainComponent.name` under `Icons/…`, a
  small square instance) → **`icon_map` first, `get_screenshot` `SVG` only as the fallback** (below).
- **Logos / brand marks are always exported**, never typed by hand.
- An **`empty: true` export rendered nothing** (node hidden / fully clipped / off-canvas — e.g. a
  marquee's off-screen edge logos). Don't ship the blank file: if grounding shows the instance has
  art, re-export its `mainComponent`; if it's genuinely empty, skip it.

## Icons: reuse before re-export (`icon_map`)

Run `icon_map` to reuse the project's curated `.svg` files instead of re-exporting duplicates:

- A `high`/`medium` match gives the file `filePath` + a `colorContract` — wire that file in, composing
  the import yourself from the path + `profile.svg.importHint` (loader form) and the project's own
  alias/relative convention (mirror how existing files import from the asset dir; `icon_map` does not
  hand you a ready specifier on purpose — the alias/relative path is project-specific).
- An `unmapped` icon with a non-empty `iconLibraries` (lucide / heroicons / iconify) can be imported
  from that library.
- Only when there's **neither** a file match **nor** a library do you `get_screenshot` `SVG` and save
  a fresh file.

## Importing svg per `profile.svg`

Returned on `component_map` / `token_map` / `icon_map`. Save under the project's asset dir
(`src/assets`, `public/…`) and wire the real file in.

- **`mode: 'component'`** — a loader (svgr / vite-svg-loader / …) is set up; `profile.svg.importHint`
  gives the **exact** import form, which differs by loader (`?react` vs `?component` vs
  `{ ReactComponent }`). Import once and render `<Icon/>`, **reusing the same import across every
  occurrence** (dedupe: one file, one import, many uses).
- **`mode: 'url'`** — no loader; `import url from './icon.svg'` + `<img src>`, or inline the svg when
  you need `currentColor` / CSS control. **Never emit `<Icon/>` in url mode** — that import won't run.

## Colouring a single-colour icon at the usage site

Don't bake the colour in — the `icon_map` `colorContract` + `recolor` say which path applies:

- **`currentColor`** — the icon's fill is `currentColor`, so it takes the element's CSS `color`:
  recolor at the call site with Tailwind `text-{token}` (or `color:` in plain CSS), **never** `fill-*`,
  and it inherits a parent's text color for free. Drive the token off the Figma icon's fill via
  `token_map`; keep the `.svg` file as `currentColor`. **Only works inlined** (component mode /
  library / inline svg) — `currentColor` can't reach an `<img>` (url mode), so inline the svg there if
  it must be recoloured.
- **`fixed`** — one colour baked into the file; render as-is, don't recolor. If the Figma fill differs
  from the file, convert its fills to `currentColor` or re-export.
- **`multi-color`** — a brand mark / illustration; render as-is, never recolor.
