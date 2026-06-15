# Verify visually (close the loop)

Loaded by **figma-codegen**. Generated code that you never render is unverified. Don't ship it on
faith — **render it with the project's own toolchain, screenshot it, compare against the Figma node,
and fix the diff.** This is the self-correcting step: it catches exactly the fidelity misses the
grounding tools warn about (dropped shadows, uniform-vs-per-side borders, wrong font sizes, missing
assets, full-bleed gutters, broken reflow) — things that only show up once pixels exist.

There is **no generic "verify" tool**, and there shouldn't be: the render entry is project-specific
(dev server vs build+preview, the port, the route, how a single component is mounted, what props/data
it needs, the runtime context). You have the project context + a shell + a browser — so drive it
yourself, per project:

1. **Render with the project's runtime.** Use what the project actually uses — e.g. Vite: `pnpm build`
   then `pnpm preview`; Next: `next build && next start`; or the existing dev server. Mount what you
   built (a page route, or a throwaway entry/harness for a single component) and make sure tokens,
   Tailwind/CSS, and exported assets are wired so the render isn't half-styled (a half-styled render
   makes the diff pure noise — that defeats the check).
2. **Screenshot at the design's real viewport.** Use Chrome headless via CDP
   `Emulation.setDeviceMetricsOverride` for an exact width — **do not trust `--window-size`** for
   exact-width/mobile shots (it renders wider than asked and crops a centered `mx-auto` root, faking a
   right-edge overflow). For wide desktop, `--headless=new --screenshot --window-size=1440,1500` is
   fine (cards have margin, nothing gets cut). Get the Figma side from `get_screenshot` on the same node.
3. **Compare and fix.** Diff the two (eyeball, or pixelmatch/odiff for a %); for each real discrepancy
   trace it back to the cause (re-`get_design_context` that node — don't re-guess from the screenshot)
   and fix the code. Re-render. Repeat until it matches.
4. **Check both breakpoints.** Re-screenshot at desktop _and_ mobile widths; confirm zero horizontal
   overflow on mobile (`document.scrollWidth === innerWidth`, allowing intentional `overflow-x-auto`
   carousels) and that the desktop layout didn't regress.
