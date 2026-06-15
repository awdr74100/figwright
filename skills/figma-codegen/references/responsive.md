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

## Full-bleed pages need a body reset — but check first

An edge-to-edge page must zero the body margin (a missing reset shows as a full-page white gutter +
horizontal overflow; scoped / CSS-module styles can't reach `html`/`body`). Don't blindly add one:
Tailwind's preflight (`profile.styling.system === 'tailwind'`) and any existing reset/normalize already
handle it. Add a minimal global reset **only** when the project is non-Tailwind and has none — and
never duplicate one that's already there. Make the reset complete: zero the body margin **and** default
block-element margins (`h1`–`h6`, `p`, `ul`, `figure`, …) + `box-sizing`. A body-only reset still
leaves default `<p>`/heading margins that inflate every stacked text block (a footer's contact rows
space out and the footer grows too tall).
