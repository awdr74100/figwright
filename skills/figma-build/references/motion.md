# Code → Motion (author animation in Figma)

The reverse of `figma-codegen`'s `references/motion.md`: when the source you're building from carries
animation — CSS `@keyframes` / `transition`, Framer Motion props, GSAP, a Vue/Svelte transition — author
it as Figma **Motion (beta)** on the frame you built, instead of dropping it to a static layout.

**Preconditions (check first, fail friendly):** Motion authoring only works in the **Figma Design**
editor, and keyframes attach to the layers of a **top-level frame** (a frame directly on the page).
Build the frame + its layers first, then animate them. FigJam / Dev Mode can't.

## Recognise the animation in the source

- **CSS** — `@keyframes name { … }` + `animation`, or a `transition` on enter/hover.
- **Framer Motion** — `initial` / `animate` / `variants`, `transition`, `whileHover`, `staggerChildren`.
- **GSAP** — `gsap.to/from/timeline`, `stagger`.
- **Vue / Svelte** — `<transition>` / `transition:` directives.

Read the real values from the source (the keyframe stops, the duration, the easing) — don't eyeball.

## Author it with the Motion tools

1. **`get_motion_styles`** first. If the animation is a common entrance (fade in, slide in from a
   direction), a preset likely matches → **`apply_animation_style`** with `config` tuning
   `duration` (seconds) and preset props (direction, distance). Prefer a preset over hand-keyframing
   when it fits — it's what a designer would reach for.
   - Props are in the preset's own units, as its `get_motion_styles` entry describes them.
   - Set timing on one side: when `props.delay` / `props.duration` and `config.timelineOffset` /
     `config.duration` are both given, the props win (measured on Position).
2. Otherwise **`apply_manual_keyframe_track`** per animated property. Map source → Figma field:

   | Source                                                      | Figma `field` (`{ type:'PROPERTY', name }`)         | `value` type       |
   | ----------------------------------------------------------- | --------------------------------------------------- | ------------------ |
   | `translateX/Y`, Framer `x`/`y`                              | `TRANSLATION_X` / `TRANSLATION_Y`                   | `FLOAT`            |
   | `translate(x, y)` together                                  | `TRANSLATION_XY`                                    | `VECTOR` `{x, y}`  |
   | `scale`                                                     | `SCALE_XY`                                          | `VECTOR` `{x, y}`  |
   | `scaleX/Y`                                                  | `SCALE_X` / `SCALE_Y`                               | `FLOAT`            |
   | `rotate` (deg)                                              | `ROTATION` (**degrees, sign flipped**: below)       | `FLOAT`            |
   | `opacity`                                                   | `OPACITY`                                           | `FLOAT`            |
   | `rotateX/Y/Z` (deg, in 3D)                                  | `TRANSFORM_3D_ROTATION_X` / `_Y` / `_Z` (CSS signs) | `FLOAT`            |
   | `translateZ` (px)                                           | `TRANSFORM_3D_TRANSLATION_Z`                        | `FLOAT`            |
   | the container's `perspective` (px)                          | `SCENE_3D_PERSPECTIVE` on that container (≥ 0)      | `FLOAT`            |
   | `border-radius`, `border-width`, width/height, gap, padding | `CORNER_RADIUS` / `STROKE_WEIGHT` / `WIDTH` / …     | `FLOAT`            |
   | colour                                                      | an indexed `fills` item                             | `COLOR` (RGBA 0–1) |

   Each `track` = `{ baseValue, keyframes: [{ timelinePosition (s), value, easing? }] }`. A CSS
   `@keyframes` `%` stop → `timelinePosition = pct/100 * duration`. Measured against Figma's render:
   - **`ROTATION` is degrees, positive = counterclockwise on screen.** CSS `rotate` is
     clockwise-positive, so `rotate(30deg)` → `ROTATION -30`.
   - **Translation values are offsets from the layer's layout position**, as CSS `translate` is.
   - A value of the wrong type for the field is refused by Figma (`SCALE_XY` takes a `VECTOR`).
   - **A 3D track's `baseValue` is the layer's static 3D value itself** (`set_transform_3d`'s
     number, or the scene's perspective): giving one rewrites it, and a layer with no 3D transform
     is given one (all 0) for the track to drive. The result's `adjusted` says when either
     happened.

3. **`set_timeline_duration`** to match the source's total duration.

### Easing (reverse map)

**A Figma keyframe's easing shapes the segment arriving at it** (measured: `HOLD` on the keyframe at
1 s held the value from 0 to 1 s). CSS and WAAPI apply a keyframe's timing function to the segment
leaving it, so put each source segment's easing on the keyframe at its end.

- `linear` → `{ type: 'LINEAR' }`; `ease-in/out/in-out` → `EASE_IN` / `EASE_OUT` / `EASE_IN_AND_OUT`.
- `cubic-bezier(x1,y1,x2,y2)` → `{ type: 'CUSTOM_CUBIC_BEZIER', easingFunctionCubicBezier: {x1,y1,x2,y2} }`.
- A **spring** → `{ type: 'CUSTOM_SPRING', easingFunctionSpring: { bounce } }` (0–1), or a named
  preset when it matches: `GENTLE` is bounce 0.25, `QUICK` ≈ 0.4226, `BOUNCY` ≈ 0.6938, `SLOW` 0.
  From a physical spring (`mass` / `stiffness` / `damping`, e.g. Framer Motion's), Figma's own
  conversion is `bounce = max(0, 1 − damping / (2·√(mass·stiffness)))` — exact on every input
  measured, so only the damping ratio carries over. The curve spans the keyframe's segment, so the
  segment length you choose sets the speed (see figma-codegen's `references/motion.md`, Springs).

A custom type needs its parameters — `CUSTOM_CUBIC_BEZIER` its four points, `CUSTOM_SPRING` its
bounce — and is refused without them.

### Bind to a variable

When the source takes an easing or a duration from a design token, bind it: pass
`{ type: 'VARIABLE_ALIAS', id }` instead of the literal. A keyframe's `easing` and a preset's
`props.easing` take an **EASING** variable; a preset's `props.delay` / `props.duration` take a
**TIMING** variable (seconds). `config.duration` and `config.timelineOffset` take numbers only. A
variable of the wrong type, or one that does not exist, is refused before anything changes. Create
them with `create_variable` (`EASING` / `TIMING`, no `scopes`) and set them with `set_variable_value`.

## Stagger → one atomic `batch` (the efficiency win)

A `staggerChildren`, a GSAP `stagger`, or per-index `animation-delay` over a row of N nodes → **one
`batch`** of N `apply_animation_style` ops, each with `config.timelineOffset = index * step`. That's a
single round-trip that's undoable as a unit (Cmd-Z once reverts the whole stagger) — don't fire N
sequential calls.

```jsonc
// batch ops for a 3-item staggered fade-in, step 0.1s
[
  {
    "tool": "apply_animation_style",
    "params": { "nodeId": "…A", "styleId": "…", "config": { "timelineOffset": 0 } },
  },
  {
    "tool": "apply_animation_style",
    "params": { "nodeId": "…B", "styleId": "…", "config": { "timelineOffset": 0.1 } },
  },
  {
    "tool": "apply_animation_style",
    "params": { "nodeId": "…C", "styleId": "…", "config": { "timelineOffset": 0.2 } },
  },
]
```

Manual keyframe tracks are also batchable (PROPERTY fields only). `set_timeline_duration` too.

## Edit or retime an existing track

`apply_manual_keyframe_track` replaces the whole track of its field, so rebuild the track from what
is there: read it with `get_node_motion` (its `manualKeyframeTracks` entry), change only the
keyframes the user named — keeping each one's `value` and `easing` — and write the whole track back.
Moving keyframes in time gives them new ids (the track keeps its id), so match keyframes by order and
time, not by id. A preset is not edited in place: `remove_animation_style`, then
`apply_animation_style` again. Extending the timeline affects every layer of the frame — say so.

## Verify

`export_video` the top-level frame to an MP4/GIF and check the motion reads right, or scrub the
timeline in Figma. Then it's the same render-and-diff loop as a static build. `design_diff` only sees
a Motion summary (preset names, animated field names, timeline length), so compare
`get_node_motion` or `get_motion_context` reads for keyframe-level changes.

## Limits (be honest)

- **Motion is beta** and Figma-Design-only; if `apply_*` reports it's unavailable, say so — don't fake
  a static approximation and call it animated.
- **Instance sublayers can't be animated** through the plugin API. Animate the main component's
  layer (every instance plays it) or detach the instance.
- **Units**: rotation in degrees with the sign flipped (above); colours RGBA 0–1.
- Author only what the source actually animates; don't invent motion the code didn't specify.
