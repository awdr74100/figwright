# Responsive by default

Loaded by **figma-codegen**. Real designs ship multiple breakpoints and modern output is expected to
be responsive — so **never hardcode the artboard width** (a root `w-[1920px]` scrolls on every smaller
screen). The root is `w-full`; sections stay fluid with content centered in a `max-w`. Ground the
breakpoints instead of guessing them:

1. **Get every breakpoint's frame — then read each one's own exact values.** When several roots are
   already selected, _those are the breakpoints_: different width buckets = different breakpoints, so
   never pick one as canonical and scale the rest by eye. Otherwise find the counterparts —
   `search_nodes` (type `FRAME`, scoped to the file/page) lists sibling frames with widths; match the
   desktop frame to its narrower ones by **width buckets** (~1920/1440 desktop · ~768 tablet · ~375
   mobile), **name normalization** (strip device prefixes — `W_`/`Ｍ_`, `Desktop`/`Mobile`, `PC`/`SP`),
   and **content similarity** (same section order + matching `textOverrides` text — works even with no
   naming convention). `get_design_context` **each** frame and take its sizes from _its own_ data:
   font size, line-height, padding, and gap for mobile come from the mobile frame, for desktop from the
   desktop frame — never carried over or shrunk from the other, and **never eyeballed off a screenshot**
   (the raster confirms layout; it is not a ruler). Mis-sized mobile text/spacing is almost always one
   breakpoint's values guessed from another's instead of read from its frame.
2. **Diff into one mobile-first base + `lg:`/`xl:` variants — both layout and values.** Differences
   split two ways. **Reflow** changes layout direction/flow — utilities on one markup
   (`flex-col lg:flex-row`, `grid-cols-1 xl:grid-cols-3`, `hidden xl:block`, alignment swaps).
   **Value scale** changes the numbers — mobile rarely just reflows desktop at the same sizes; type,
   spacing, and radii usually shrink (h1 28→48, padding 16→80, gap 12→32). Emit those as responsive
   value variants too (`text-3xl lg:text-6xl`, `px-4 lg:px-20`, `gap-3 lg:gap-8`), each side grounded
   from its own breakpoint's data — not the base value reused at every width. Only a **structure swap**
   needs twin `xl:hidden` / `hidden xl:block` markup: when the content _semantics_ differ (a CTA `登入`
   on mobile vs `聯絡我們` on desktop) or the layout systems are incompatible (hamburger vs full nav, an
   absolute hero vs a flow stack).
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
