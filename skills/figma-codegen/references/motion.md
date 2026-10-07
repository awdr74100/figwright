# Motion → code (carry Figma animation into the project)

Figma Motion (beta) animates the layers of a top-level frame: applied **animation-style presets**
(fade / slide in), **keyframe tracks** on properties (translate, scale, rotate, opacity, …), paints
and effects, all on the frame's **timeline**. Carry it into the project's animation mechanism instead
of dropping it — a static component from an animated frame is a fidelity miss, the same class as
dropping a shadow.

## Read the animation

1. **`get_motion_context`** once on every root you implement. It walks the whole subtree — hidden
   layers and each instance's own children included, never deduped — and lists every node with an
   applied preset or a keyframe, with its raw Motion record.
   - Only `coverage.status: "complete"` with no nodes means nothing animates. The `motion` summary in
     `get_design_context` is a hint that dedupe, depth and budget all drop.
   - `"partial"`: call it again on each `pendingNodeIds` entry before treating the inventory as
     whole; `pendingOmitted` > 0 means more unread roots than one response could list — say so.
   - `diagnostics`: `read-error` (that node was not read), `node-over-budget` (too large for one call;
     `get_node_motion` reads it whole).
2. Per node as needed: `get_design_context` on a listed id for its static styling, `get_node_motion`
   for one node's record, `get_motion_styles` for a preset's prop descriptions, `get_variable_defs`
   for a `{ type: "VARIABLE_ALIAS", id }`.

If the inventory is complete and empty, there's no animation to carry — don't invent one.

## What the record says

- **`animations`** holds every track that plays — those a preset generated (they carry
  `animationPreset`) and the manual ones — so implement from it, and don't add the presets on top.
  `get_motion_context` leaves out of **`manualKeyframeTracks`** each manual track `animations`
  already plays as stored, keeping only those whose easing is bound to a variable.
- A binding is `{ baseValue, timelineDuration, tracks[] }`; a track is `{ keyframeOperation,
  keyframes[] }`, each keyframe `{ timelinePosition (s), value, easing }`.
- **`animationStyles`** are the applied presets with their `duration`, `timelineOffset` and `props`.
  A preset's `name` can read as a localization key (`motion.preset_name.opacity`) and its `styleId`
  as a `CodeComponentId:…` — identify it by its props, not those.
- **`timelines`** give each timeline's `id` and `duration`; nodes on one timeline id share a clock.
- **Variable aliases** — an easing or preset prop may read `{ type: "VARIABLE_ALIAS", id }`. A
  keyframe easing bound to a variable stays the alias in `manualKeyframeTracks` while `animations`
  carries the resolved curve; a preset's `props.delay` bound to a TIMING variable also reads back
  resolved in its `timelineOffset`, and with `props.duration` bound the style's own `duration` is
  absent. An alias is a design token: implement it as one (a CSS custom property, a shared constant),
  not as its resolved value.

## How Figma plays it (measured against its render)

- **Easing belongs to the arriving keyframe**: a keyframe's easing shapes the segment that ends at
  it. CSS `@keyframes` and WAAPI apply a keyframe's timing function to the segment that starts at it,
  so each emitted keyframe takes the easing of the Figma keyframe after it.
- **Time**: a manual track's `timelinePosition` is timeline seconds; a preset track's is relative to
  its preset's `timelineOffset`. Keyframes are not evenly spaced — use the times as they are.
- **Units**: `ROTATION` is degrees with positive = counterclockwise on screen — CSS `rotate` is
  clockwise-positive, so negate. Translation is an offset from the layer's layout position, as CSS
  `translate` is. `SCALE_XY` / `TRANSLATION_XY` values are `{x, y}`.
- **`HOLD`** keeps the previous value up to its keyframe and switches exactly there.

### Map to the detected stack

Emit animation in the project's existing mechanism (check what's already used before adding a dep):
CSS `@keyframes` / `transition`, Framer Motion, GSAP, Vue `<transition>`, Svelte transitions.

| Figma field                                                                       | CSS / transform                 | Framer Motion                 |
| --------------------------------------------------------------------------------- | ------------------------------- | ----------------------------- |
| `TRANSLATION_X` / `TRANSLATION_Y` / `TRANSLATION_XY`                              | `translateX/Y` (`transform`)    | `x` / `y`                     |
| `SCALE_X` / `SCALE_Y` / `SCALE_XY`                                                | `scaleX/Y`                      | `scaleX` / `scaleY` / `scale` |
| `ROTATION`                                                                        | `rotate` (deg, **negated**)     | `rotate` (deg, **negated**)   |
| `OPACITY`                                                                         | `opacity`                       | `opacity`                     |
| `CORNER_RADIUS`, `STROKE_WEIGHT`, `WIDTH`/`HEIGHT`, `STACK_SPACING`, padding, gap | the matching CSS prop           | style value                   |
| effect fields (shadow `OFFSET_X`/`RADIUS`/`COLOR`, …)                             | animate `box-shadow` / `filter` | `boxShadow` etc.              |

A `FLOAT` keyframe value is the raw number; `COLOR` is RGBA 0–1 (→ hex/rgb); `VECTOR` is `{x,y}`.

| Figma `MotionEasing.type`                                | CSS                                                          | Framer                                   |
| -------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| `LINEAR`                                                 | `linear`                                                     | `"linear"`                               |
| `EASE_IN` / `EASE_OUT` / `EASE_IN_AND_OUT`               | `ease-in` / `ease-out` / `ease-in-out`                       | `"easeIn"` / `"easeOut"` / `"easeInOut"` |
| `EASE_*_BACK`, `CUSTOM_CUBIC_BEZIER`                     | `cubic-bezier(x1,y1,x2,y2)` from `easingFunctionCubicBezier` | that array                               |
| `GENTLE` / `QUICK` / `BOUNCY` / `SLOW` / `CUSTOM_SPRING` | the spring curve below                                       | the spring curve below                   |
| `HOLD`                                                   | `steps(1, jump-end)`                                         | `steps`                                  |

A siblings row sharing a preset but stepping its `timelineOffset` (0, 0.1, 0.2, …) is a **staggered
entrance**: emit it as stagger (Framer `staggerChildren`, CSS `animation-delay: calc(var(--i) * …)`,
GSAP `stagger`), not N hardcoded delays.

## Springs

**Measured:** a spring is recorded as its easing `type` and a normalized `bounce`; the named ones
store `GENTLE` 0.25, `QUICK` ≈ 0.4226, `BOUNCY` ≈ 0.6938, `SLOW` 0, and render as a `CUSTOM_SPRING`
of that bounce. The curve spans its keyframe's whole segment, so the segment length — not a physical
stiffness — sets its speed. Figma derives bounce from a physical spring as `max(0, 1 − ζ)` with
damping ratio `ζ = damping / (2·√(mass·stiffness))`, so `ζ = 1 − bounce` for a bounce above 0;
stiffness and mass are not recoverable.

**Fitted** to Figma's renders — a fit, not Figma's documentation. With `u` the normalized time in the
segment (0 → 1), `b` the bounce and `ζ = 1 − b`:

- `0.01 ≤ b ≤ 0.8`: `ζω = 7.004 − ½·ln(b + 0.01025)`, `ω = ζω / ζ`, `ω_d = ω·√(1 − ζ²)`,
  `x(u) = 1 − e^(−ζω·u)·(cos(ω_d·u) + (ζω/ω_d)·sin(ω_d·u))`.
- `b = 0`: `x(u) = 1 − (1 + 11.25·u)·e^(−11.25·u)`.

Checked against fresh renders at bounce 0, 0.25, 0.5 and 0.8 over a 1 s segment, and 0.5 over
2 s: within 0.4 px per 100 px of travel. Past that range it is an extrapolation — say so. Where the
platform takes no function (CSS, WAAPI), sample it into `linear()` finely enough to keep the
overshoot. Report a spring built this way as "Figma's spring per a measured fit".

## Not in the record — never fill in a default as if it were

Loop / repeat, trigger (load, hover, click, scroll), interruption, transform origin / pivot, and
reduced-motion behaviour. Prototype reactions (`get_reactions`) are a separate system from Motion
playback. Ask the user, or state the policy you chose as yours.

## Verify

Compare the implementation with the source at the start, mid-segment, at each keyframe and the end:
the browser's computed style or transform against the record's values, plus frames of an
`export_video` of the frame as a visual reference.
