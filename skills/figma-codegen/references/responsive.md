# Responsive by default

Loaded by **figma-codegen**. Real designs ship multiple breakpoints and modern output is expected to
be responsive — so **never hardcode the artboard width** (a root `w-[1920px]` scrolls on every smaller
screen). The root is `w-full`; sections stay fluid with content centered in a `max-w`. Ground the
breakpoints instead of guessing them:

1. **Find the other breakpoints.** `search_nodes` (type `FRAME`, scoped to the file/page) lists
   sibling frames with widths. Match the desktop frame to its narrower counterparts by **width
   buckets** (~1920/1440 desktop · ~768 tablet · ~375 mobile), **name normalization** (strip device
   prefixes — `W_`/`Ｍ_`, `Desktop`/`Mobile`, `PC`/`SP`), and **content similarity** (same section
   order + matching `textOverrides` text — works even with no naming convention). `get_design_context`
   each matched frame.
2. **Diff into one mobile-first base + `lg:`/`xl:` variants.** Most differences are **reflow** — a
   single markup with utilities (`flex-col lg:flex-row`, `grid-cols-1 xl:grid-cols-3`,
   `hidden xl:block`, alignment swaps). Only a **structure swap** needs twin `xl:hidden` /
   `hidden xl:block` markup: when the content _semantics_ differ (a CTA `登入` on mobile vs `聯絡我們`
   on desktop) or the layout systems are incompatible (hamburger vs full nav, an absolute hero vs a
   flow stack).
3. **A fixed-width desktop layout's breakpoint must be ≥ its content width** — gate a 1180px row at
   `xl:`/1280, not `lg:`/1024, or it overflows at in-between sizes; below it, fall back to the stack.

No other-breakpoint frame? Still output best-effort RWD (fluid container + sensible reflow) and note
the responsive behaviour is inferred, not grounded.

## Same-size siblings can be a state, not another breakpoint

Before treating a sibling frame as a breakpoint, check it isn't a **UI state** of a screen you already
have. A sibling that's the **same size** as a screen (same width bucket — two 375 frames are not two
mobile breakpoints), named for a state (`側選單` / `menu` / `open` / `modal` / `drawer` / `expanded`),
and carrying a **dismiss affordance** (an `icon/close` / X, a back arrow) is the open state of that
screen — not another page, and not another breakpoint to diff. Render it as an **overlay on the base
screen**, sized to what the design shows:

- Panel **fills** the artboard → full-screen overlay: `fixed inset-0` + `w-full` (a mobile menu that
  occupies the whole viewport). **Never a fixed-width sidebar** — that's the classic miss: a 375-wide
  menu artboard is the viewport, not a `w-[375px]` drawer.
- Panel **narrower** than the artboard → a drawer/sheet at its **actual** width (`w-[Xpx]` or a
  fraction) over a translucent scrim, anchored to the edge it sits on.

Wire it to its trigger (the hamburger that opens it, the X that closes it) as a toggle; if interaction
state is out of scope, surface a TODO per SKILL — but still emit it as an overlay, never as a
standalone page.

## Full-bleed pages need a body reset — but check first

An edge-to-edge page must zero the body margin (a missing reset shows as a full-page white gutter +
horizontal overflow; scoped / CSS-module styles can't reach `html`/`body`). Don't blindly add one:
Tailwind's preflight (`profile.styling.system === 'tailwind'`) and any existing reset/normalize already
handle it. Add a minimal global reset **only** when the project is non-Tailwind and has none — and
never duplicate one that's already there. Make the reset complete: zero the body margin **and** default
block-element margins (`h1`–`h6`, `p`, `ul`, `figure`, …) + `box-sizing`. A body-only reset still
leaves default `<p>`/heading margins that inflate every stacked text block (a footer's contact rows
space out and the footer grows too tall).
