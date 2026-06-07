import type { GetPromptResult, Prompt } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// The cross-client twin of the figma-codegen Claude Code skill: a distilled, guided workflow any MCP
// client (Cursor / Windsurf / Claude Desktop) can surface as a slash command. The deep version lives
// in packages/skills/figma-codegen/SKILL.md; this is intentionally the short form — it names the
// three grounded tools, their order, and the reuse/token rules, which is what a client without the
// skill needs. Kept short so it tracks the skill's intent without re-deriving its detail.

export const FIGMA_TO_CODE_PROMPT_NAME = 'figma_to_code';

/** Build the guided-workflow text, pointing the three tools at a node id or the current selection. */
const promptText = (nodeId: string | undefined): string => {
  const target = nodeId === undefined ? 'the current Figma selection' : `Figma node ${nodeId}`;
  const arg =
    nodeId === undefined ? '(they default to the current selection)' : `with nodeId "${nodeId}"`;
  return `Generate code for ${target} that matches this project — reuse what already exists, build only what is missing. Do not guess layout from a screenshot; ground every decision in these tools, called ${arg}:

1. get_design_context (detail: full, dedupeComponents: true) — the layout tree with tokens resolved to names and each instance's componentProperties. Do not depth-limit a subtree you intend to build from: the first instance of a repeated component keeps its full structure while later ones show "deduped". A deduped instance still carries textOverrides (the visible text it actually renders, { name, characters } per TEXT) — fill each repeated element's content from that, since the structure is identical but the text differs per instance; don't copy the first instance's text or re-fetch the un-deduped tree just to get distinct titles / labels / rows. Per node, carry every visual property the tree exposes, not just layout: fills, strokes, cornerRadius, opacity, and especially effects (a node's effects / styleIds.effect = a drop/inner shadow or blur — translate it to the stack's shadow utility). Effects are the easiest fidelity to drop because they come from a shared effect style and read as a single field; a card with no shadow when the design has one is the classic grounding miss. When strokeWeight is "mixed" the node also carries strokeWeights { top, right, bottom, left }: emit only the non-zero sides (border-t / border-b / …), never a uniform border — collapsing a per-side stroke into a full border turns a table row divider or underline input into a full grid. A GRADIENT_LINEAR/RADIAL/ANGULAR/DIAMOND fill carries gradientStops ({ position, color hex }) + gradientTransform (the 2×3 axis matrix): emit a real CSS gradient (linear-gradient/radial-gradient) from the stops with the direction derived from the transform — don't flatten a gradient to a solid colour (same miss class as a dropped shadow). An IMAGE/VIDEO fill carries scaleMode (the object-fit equivalent: FILL→cover, FIT→contain, CROP→cover+position, TILE→repeat) — apply it to the exported image so it isn't stretched or letterboxed. If a whole page is too big to ground in one call (a dense ~330-node tree can exceed the context window / token cap), don't retry the same oversized call and don't depth-cap the whole page (a shallow tree drops the structure inside each section → empty cards): scope horizontally — get the top-level section node ids first (detail: minimal, or read the page's direct children), then get_design_context each section by its nodeId at full detail and build it before moving on. Ground EVERY section this way — never eyeball values (font-size, colour, padding, radius) off the screenshot for "the easy ones"; that produces a cascade of systematic errors (headings all too small, wrong accent colour, off paddings, a missing border) even though get_design_context had every exact value. The screenshot is visual intent only; if you're about to type a number you didn't read from grounding, re-get_design_context that node.

2. component_map — every Figma component grouped to a local code component with a status.
   - high / medium: import and reuse candidate.filePath; do not regenerate it.
   - Wire each entry's instances[].props (resolved variant / boolean / text values) onto the reused component — one element per instance, each with its own props.
   - candidate.unmatchedProps are props the design needs but the component lacks → surface them as component-extension TODOs, never fake them with ad-hoc markup.
   - unmapped: build it new in the project's style. For a repeated unmapped component (instanceCount > 1, e.g. a table row), build from its first instance's subtree; drill instances[0].nodeId if it was scoped away.

3. token_map — every Figma variable joined to a project token. Reference candidate.ref (e.g. bg-primary-500 or var(--color-primary-500)), never the raw hex/px. A 'framework-builtin' status (Tailwind built-in scale, e.g. spacing/4, line-height/7, weight/Bold) carries builtin.{scale,step}: for spacing compose the step with the bound property (p-4 / gap-4 / m-4), for line-height use leading-{step} (leading-7), for font-weight use font-{step} (font-bold) — use the utility, not an arbitrary p-[16px], and don't report it as a gap. Only a genuinely 'unmapped' variable is a gap — use the value but call it out, don't hardcode it silently.

4. get_screenshot (or save_screenshots to write straight to disk) — export the assets grounding can't encode. Logos, photos, and icons have no pixels in the layout tree and otherwise render as grey blocks, often half the visible surface. For each visual-only leaf — a node with an IMAGE fill (a photo), a VECTOR / boolean-op, or an icon instance (e.g. mainComponent.name under Icons/…) — export it (SVG for vector/icon, PNG scale 2 for photos) into the project's asset dir and import the real file. Logos and brand marks are always exported, never typed by hand. For svg icons, import/use them per profile.svg (returned on component_map / token_map): mode 'component' (a loader like svgr / vite-svg-loader is set up — profile.svg.importHint gives the exact form, which differs: ?react vs ?component vs { ReactComponent }) → import once and render <Icon/>, reusing the same import across every occurrence (dedupe: one file, one import, many uses); mode 'url' (no loader) → import the svg as a URL and use <img src> (or inline the svg when you need currentColor / CSS control). Never emit <Icon/> when mode is 'url' — that import won't run. If an export comes back empty:true (the node rendered nothing — hidden / fully clipped / off-canvas, e.g. a marquee's off-screen edge logos), don't ship the blank file: if grounding shows that instance has art, re-export its mainComponent; if the node is genuinely empty, skip it.

5. Responsive by default — output RWD, never hardcode the artboard width (a root w-[1920px] scrolls on every smaller screen; the root is w-full, sections fluid with content centered in a max-w). Ground the breakpoints, don't guess them: search_nodes (type FRAME, scoped to the file/page) lists sibling frames with their widths — match the desktop frame to its narrower counterparts by three signals: width buckets (~1920/1440 desktop, ~768 tablet, ~375 mobile), name normalization (strip device prefixes — W_/Ｍ_, Desktop/Mobile, PC/SP), and content similarity (same section order + matching textOverrides text, which works even when names don't follow a convention); then get_design_context each matched frame. Diff the layouts into one mobile-first base + lg:/xl: variants: most differences are reflow handled by a single markup with utilities (flex-col lg:flex-row, grid-cols-1 xl:grid-cols-3, hidden xl:block, alignment swaps); only a structure swap needs twin xl:hidden / hidden xl:block markup — when the content semantics differ (a CTA labelled 登入 on mobile vs 聯絡我們 on desktop) or the layout systems are incompatible (a hamburger vs a full nav, an absolute-positioned hero vs a flow stack). A fixed-width desktop layout's breakpoint must be ≥ its content width (gate a 1180px row at xl:/1280, not lg:/1024, or it overflows at in-between sizes). If no other-breakpoint frame exists, still output best-effort RWD (fluid container + sensible reflow) and note the responsive behaviour is inferred, not grounded.

6. Verify visually (close the loop) — don't ship code you never rendered. Render it with the project's own toolchain (e.g. Vite build + preview, Next build + start, or the existing dev server), mount what you built (a page route, or a throwaway harness for a single component) with tokens/CSS/exported assets wired so it isn't half-styled, then screenshot at the design's real viewport and diff against the Figma node (get_screenshot on the same node). Use Chrome headless via CDP Emulation.setDeviceMetricsOverride for an exact width — do not trust --window-size for exact-width/mobile shots (it renders wider than asked and crops a centered mx-auto root, faking a right-edge overflow); --headless=new --screenshot --window-size=1440,1500 is fine for wide desktop. For each real discrepancy, trace it to its source (re-get_design_context that node, don't re-guess from the screenshot) and fix the code, then re-render. Check both desktop and mobile widths and confirm zero horizontal overflow on mobile. There is no generic verify tool and shouldn't be — the render entry (dev server vs build+preview, port, route, how a component mounts, its props/runtime context) is project-specific, so you drive it with your shell + browser.

Emit code in the detected stack (the profile is returned on component_map / token_map). Rules: ground every section (every px size, colour, font-size, radius, spacing comes from get_design_context, for every section not just the first few — never eyeball the screenshot to save effort), reuse beats regenerate, reference tokens not literals, export visual assets rather than faking them with grey boxes or hand-typed wordmarks, output responsive code with a w-full root (never the artboard's fixed width), render and verify against the Figma node before calling it done, and mirror the project's existing import style, file layout, and naming. For an edge-to-edge (full-bleed) page, the body margin must be zeroed (a missing reset shows as a full-page white gutter + horizontal overflow, since scoped / CSS-module styles can't reach html/body) — but check first, don't blindly add one: Tailwind's preflight (profile.styling.system 'tailwind') and any existing reset/normalize already do this, so only add a minimal global reset when the project is non-Tailwind and has none — and make it complete: zero the body margin AND the default block-element margins (h1–h6, p, ul, figure, …) + box-sizing. A body-only reset still leaves default <p>/heading margins that inflate every stacked text block (e.g. a footer's contact rows get extra spacing and the whole footer grows too tall).`;
};

export const figmaToCodePrompt: {
  definition: Prompt;
  argsSchema: { nodeId: z.ZodOptional<z.ZodString> };
  build: (args: Record<string, string> | undefined) => GetPromptResult;
} = {
  definition: {
    name: FIGMA_TO_CODE_PROMPT_NAME,
    description:
      'Generate framework-aware code from a Figma selection that reuses the project’s existing ' +
      'components and design tokens instead of regenerating them (the cross-client form of the ' +
      'figma-codegen workflow: get_design_context + component_map + token_map).',
    arguments: [
      {
        name: 'nodeId',
        description: 'Figma node id to generate from; omit to use the current selection',
        required: false,
      },
    ],
  },
  // McpServer.registerPrompt builds the advertised `arguments` list from this shape; prompt args are
  // always strings, so an optional string mirrors the `nodeId` argument above.
  argsSchema: {
    nodeId: z
      .string()
      .optional()
      .describe('Figma node id to generate from; omit to use the current selection'),
  },
  build: (args): GetPromptResult => ({
    description: 'Figma → code via the three grounded tools (reuse components, reference tokens)',
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: promptText(args?.nodeId) },
      },
    ],
  }),
};
