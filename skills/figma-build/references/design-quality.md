# Design quality: when there is no design to copy

Loaded when you build from a vague description, into an empty file, or from code that carries no
design intent (unstyled markup, a wireframe). With a design system or exact values to follow, the
write rules decide everything and this file adds nothing. Without them, the failure is not wrong
values but **no decisions**: every spacing, size and colour chosen locally, so nothing agrees.

## 1. Decide, then say it — before drawing

Write a five-line brief and show it to the user in one message, then build to it. A wrong brief is
cheap to correct; a wrong screen is not.

- **Surface**: what it is, who for, which viewport (mobile `390×844`, tablet `834×1194`, desktop
  `1440×900`). One top-level frame per viewport, never one frame stretched.
- **Colour**: one neutral ramp (background, surface, border, muted text, ink) + one accent. Accent
  carries actions and nothing else. A second hue only for status (success / warning / error).
- **Type**: one family, two weights at most for the body of the design (Regular + Semibold),
  sizes from the scale below.
- **Space**: the 4px grid; gaps from `4 8 12 16 24 32 48 64 96`.
- **Shape**: one radius for controls, one step larger for cards; borders `1px` in the border colour.

Then create the brief as variables (`create_variable_collection` / `create_variable`) and **bind to
them**, so the design is a system and the next edit is one change. Skip the variables only for a
throwaway sketch the user called one.

## 2. Scales that read as designed

| Role            | Mobile | Desktop | Line height | Weight         |
| --------------- | ------ | ------- | ----------- | -------------- |
| Caption / label | 12     | 12–13   | 1.4         | Regular/Medium |
| Body            | 14–16  | 16      | 1.5–1.6     | Regular        |
| Subtitle / lead | 18     | 20      | 1.4         | Regular/Medium |
| Title (section) | 22–24  | 28–32   | 1.25        | Semibold       |
| Display (page)  | 28–32  | 44–56   | 1.1–1.2     | Semibold/Bold  |

- **Hierarchy comes from 3 levels, not 7.** Size _and_ weight _and_ colour together: a heading is
  bigger, bolder and darker than body. If two text layers differ by 1–2px they are one size drawn
  wrong — snap them.
- **Line length** 45–75 characters (about `560–680px` at 16px). A paragraph spanning 1200px is
  unreadable however nicely it is spaced; set `maxWidth` on the text via `set_layout_props`.
- **Heading-to-body gap is smaller than section-to-section gap** (proximity): title→text `8–12`,
  block→block `24–32`, section→section `64–96` desktop / `40–56` mobile.
- **Contrast**: body text ≥ `4.5:1`, large text and UI strokes ≥ `3:1`. Muted text on a tinted
  surface is where this fails; check it, don't eyeball it.
- **Touch targets** ≥ `44×44` (iOS) / `48×48` (Android) on mobile, ≥ `32` high on desktop.
- **Nested radii**: inner radius = outer radius − the padding between them, or the corners look
  pinched.

## 3. Layout recipes (all auto-layout; one create call each)

- **Page**: `VERTICAL`, width `FILL`/`FIXED` viewport, sections stacked, `itemSpacing 0` (sections
  own their padding). **Section**: `VERTICAL`, vertical padding per the gaps above, content
  container `maxWidth 1200` centred with `counterAxisAlignItems: 'CENTER'` on the section.
- **Button**: `HORIZONTAL`, `HUG`×`HUG`, padding `12 20` (default) / `8 14` (small), gap `8` to its
  icon, both axes `CENTER`. Never a fixed-size rectangle with a text layer on top.
- **Card**: `VERTICAL`, padding `16–24`, gap `12–16`, radius one step above controls, a `1px`
  border or a soft shadow — not both, not neither.
- **Card grid**: `GRID` with `gridItemsPositioning: 'ROW_AUTO_FLOW'` and `gridAutoTracks: 'ROWS'`;
  columns `3` desktop / `1` mobile as separate frames.
- **Form field**: `VERTICAL` gap `6–8`: label (caption, medium), input (`HUG` height ≈ `40–44`,
  `FILL` width, padding `10 12`, border), helper/error (caption). Stack fields with gap `16–20`.
- **List row**: `HORIZONTAL`, height `56–72`, leading icon/avatar, `FILL` text block, trailing
  action; a `1px` divider as the row's bottom stroke (`strokeBottomWeight`), not a separate line.
- **Nav / header**: `HORIZONTAL`, `primaryAxisAlignItems: 'SPACE_BETWEEN'`, logo left, actions
  right, height `56–72`.
- **Icon + label, avatar + name, stat + caption**: a `HORIZONTAL` or `VERTICAL` pair with gap
  `4–8`, never two loose layers positioned by eye.

## 4. Responsive: separate frames, same system

Build the mobile frame first (the harder constraint), then the desktop one from the same variables.
Use `FILL` widths and `minWidth`/`maxWidth` so each frame is internally fluid. Do not "scale" a
desktop frame down: change the column count, the type step, and the section padding on purpose.

## 5. The loop: build a section, audit it, then look at it

For each section, in order:

1. Build it (`create_frame` with `autoLayout`, `fills`, `cornerRadius` and `layoutSizing*` inline;
   `create_text` with its typography inline). Aim for the fewest calls that leave nothing unstyled.
2. **`audit_layout`** on that section's root. It measures, so it catches what a screenshot hides:
   clipped or overflowing content, a frame left at `100×100`, a child `1.5px` off-centre, edges
   `1px` apart, spacing off the 4px scale, a flat type hierarchy. Fix every `error` and `warning`;
   an `info` is a prompt to check intent, not a defect.
3. **`get_screenshot`** and judge what the audit cannot: balance, density, whether the eye lands
   on the right thing first (squint — the most important element should still stand out), and
   whether it feels like one design.
4. Next section. After the last, `audit_layout` the whole page once, and read `typography` and
   `hardcodedFills` in the result: more than ~6 font sizes, or many raw fills in a file you set up
   variables for, means you drifted from the brief.

## 6. Content is part of the design

Use realistic copy, names and numbers (a heading that says what the section is, a price with a
currency, a date in a plausible range). Lorem ipsum hides overflow and hierarchy problems that real
strings expose — an audit passes on "Title" and fails on "Quarterly revenue by region (unaudited)".
Check long strings, short strings and an empty state before calling a component done.

## 7. Say what you did not do

If a request needed something the tools cannot draw (freeform pen paths, editing a vector's points,
image generation) or you substituted (an SVG import for a custom shape), say so in the summary.
Report what `audit_layout` still flags and why you left it, instead of describing the design as
finished.
