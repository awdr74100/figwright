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
2. Otherwise **`apply_manual_keyframe_track`** per animated property. Map source → Figma field:

   | Source                                                      | Figma `field` (`{ type:'PROPERTY', name }`)     | `value` type       |
   | ----------------------------------------------------------- | ----------------------------------------------- | ------------------ |
   | `translateX/Y`, Framer `x`/`y`                              | `TRANSLATION_X` / `TRANSLATION_Y`               | `FLOAT`            |
   | `scale`, `scaleX/Y`                                         | `SCALE_XY` / `SCALE_X` / `SCALE_Y`              | `FLOAT`            |
   | `rotate` (deg)                                              | `ROTATION` (**radians** — `rad = deg * π/180`)  | `FLOAT`            |
   | `opacity`                                                   | `OPACITY`                                       | `FLOAT`            |
   | `border-radius`, `border-width`, width/height, gap, padding | `CORNER_RADIUS` / `STROKE_WEIGHT` / `WIDTH` / … | `FLOAT`            |
   | colour                                                      | an indexed `fills` item                         | `COLOR` (RGBA 0–1) |

   Each `track` = `{ baseValue, keyframes: [{ timelinePosition (s), value, easing? }] }`. A CSS
   `@keyframes` `%` stop → `timelinePosition = pct/100 * duration`.

3. **`set_timeline_duration`** to match the source's total duration.

### Easing (reverse map)

- `linear` → `{ type: 'LINEAR' }`; `ease-in/out/in-out` → `EASE_IN` / `EASE_OUT` / `EASE_IN_AND_OUT`.
- `cubic-bezier(x1,y1,x2,y2)` → `{ type: 'CUSTOM_CUBIC_BEZIER', easingFunctionCubicBezier: {x1,y1,x2,y2} }`.
- A **spring** (Framer `type:'spring'`, GSAP elastic) → `{ type: 'CUSTOM_SPRING', easingFunctionSpring: { bounce } }`
  (normalized 0–1), or a named preset (`GENTLE`/`QUICK`/`BOUNCY`/`SLOW`) when it's close.

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

## Verify

`export_video` the top-level frame to an MP4/GIF and check the motion reads right, or scrub the
timeline in Figma. Then it's the same render-and-diff loop as a static build.

## Limits (be honest)

- **Motion is beta** and Figma-Design-only; if `apply_*` reports it's unavailable, say so — don't fake
  a static approximation and call it animated.
- **Rotation/units**: degrees → radians; colours → RGBA 0–1.
- Author only what the source actually animates; don't invent motion the code didn't specify.
