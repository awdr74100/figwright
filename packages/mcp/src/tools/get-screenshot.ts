import { type GetScreenshotResult, SCREENSHOT_FORMATS } from '@figwright/shared';
import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_SCREENSHOT_TOOL_NAME = 'get_screenshot';

export const getScreenshotTool: ToolSpec = {
  name: GET_SCREENSHOT_TOOL_NAME,
  description:
    'Export nodes as images the model can see, one image block per node: { images: [{ nodeId, format, ' +
    'base64, width?, height?, scale?, recovered?, empty? }] }. format is PNG (default) / JPG / SVG. ' +
    'scale applies to raster formats; when omitted, each node is auto-fitted to a legible size ' +
    '(long edge into ~512–2576px: oversized frames scale down, tiny icons scale up ≤4x) — pass an ' +
    'explicit scale to force one. An explicit scale is capped so the long edge stays within 2576px, ' +
    'the most a vision model resolves: past that the model sees the identical pixels, so the extra ' +
    'bytes buy no detail — use save_screenshots when you need a full-res file on disk. Past 20 ' +
    'nodes in one call the whole batch drops to a 2000px long edge, which is what providers require ' +
    'of many-image requests; ask for fewer nodes when you need the detail. A batch is also capped ' +
    'by total size, not just resolution: a full-page frame is ~2.4MB, so 3–4 of them fill one ' +
    'response. Past that the remaining nodes come back labelled but not inlined, with a note naming ' +
    'them — re-request those ids in a follow-up call, or use save_screenshots for many nodes at once. ' +
    'Each raster label reports the exported width×height px and the ' +
    'scale, the anchor for mapping raster px back to design px. base64 is null for missing or ' +
    'non-exportable nodes. Nodes that are fully clipped or off-canvas (carousels, masks, off-screen ' +
    'states) are auto-recovered at their intrinsic bounds and flagged recovered:true. empty:true ' +
    'means the node genuinely renders nothing even unclipped (hidden / no content) so the export is blank.',
  inputSchema: z.object({
    nodeIds: z.array(z.string()).describe('Figma node ids to export'),
    format: z
      .enum(SCREENSHOT_FORMATS)
      .describe('Export format: PNG (default) / JPG / SVG')
      .optional(),
    scale: z
      .number()
      .positive()
      .describe('Raster scale factor (PNG/JPG); omit to auto-fit each node to a legible size')
      .optional(),
  }),
  kind: 'read',
  // See index.ts: the public path dispatches with forVision so the sandbox caps an oversized scale
  // to what a vision model resolves. save_screenshots dispatches the same tool without it, and with
  // `binary` instead — its bytes land on disk, so they skip base64 (export_pdf / export_video /
  // save_image_fills send the same flag, but they are `kind: 'local'` and so are not recorded here).
  injectedArgs: ['forVision', 'binary'],
};
/** A subset of MCP tool-result content blocks this tool emits. */
export type ScreenshotContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

const RASTER_MIME: Partial<Record<string, string>> = { PNG: 'image/png', JPG: 'image/jpeg' };

/**
 * How many bytes of inlined payload one result may carry.
 *
 * An MCP client reads each stdio message into a bounded buffer — 10 MB by default since SDK 1.30.0,
 * on both the v1 and v2 lines. Exceeding it is not a failed call: the client's transport throws,
 * closes the connection, and every later call answers "Not connected" until the user reconnects the
 * server by hand. It cannot resynchronize instead, because stdio framing is newline-delimited and
 * the discarded remainder of an oversized message has no findable boundary.
 *
 * This is the only Figwright tool that can get near it. Text results are held far below by the
 * client's own output cap (Claude Code: MAX_MCP_OUTPUT_TOKENS = 25k tokens, measured at roughly 50k
 * chars of minified JSON — see DESIGN_CONTEXT_TOKEN_BUDGET), but image blocks are not counted as
 * text, so they are the one payload that reaches the transport unmetered — measured at ~2.4 MB for
 * a single 1440×3140 frame, so four frames pass Claude Desktop's 1 MB content limit and ten pass
 * the transport's 10 MB.
 *
 * The budget is derived from that limit rather than picked, and deliberately sits just under it
 * rather than comfortably under it. A budget lower than it needs to be would withhold exports the
 * transport could have carried perfectly well — turning a working single-node call into a deferred
 * one, which is a regression, not a safeguard. The margin only has to cover what rides alongside
 * the payloads (labels, the closing note, the JSON-RPC envelope), and that measures under 1 KB;
 * half a megabyte is three orders of magnitude more than it needs.
 *
 * This is the batch-level twin of a cap the sandbox already applies per image: `capScaleForVision`
 * bounds one raster's pixels partly because a single image has its own provider ceiling (10 MB
 * base64 on the Claude API, 5 MB on Bedrock/Vertex). That cap bounds bytes only indirectly, through
 * resolution, and it says nothing about how many images ride in one response — which is the gap
 * this closes. The two ceilings are independent: passing this budget does not make an individual
 * export acceptable to a provider, and vice versa.
 *
 * Figma's own MCP server sidesteps all of this by taking a single node per call and pointing
 * multi-node work at a separate download tool. Figwright accepts a batch — which is genuinely
 * useful for comparing screens in one round trip — and a batch is exactly what makes this budget
 * necessary rather than optional.
 */
const CLIENT_READ_BUFFER_BYTES = 10 * 1024 * 1024;
export const INLINE_IMAGE_BUDGET_BYTES = CLIENT_READ_BUFFER_BYTES - 512 * 1024;

/** Serialized size of a content block as the transport will count it. */
const blockBytes = (block: ScreenshotContent): number =>
  Buffer.byteLength(JSON.stringify(block), 'utf8');

/**
 * Turn a get_screenshot result into MCP content blocks so the model can actually _see_ raster
 * exports (PNG/JPG as image blocks) instead of receiving an opaque base64 string. SVG is returned
 * as readable markup text; missing/non-exportable nodes become a short text note.
 *
 * Payloads are inlined only while they fit {@linkcode INLINE_IMAGE_BUDGET_BYTES}. Past that, the
 * remaining nodes keep their labels — so the model still knows what it asked for and can re-request
 * them — and a closing note names them and says how to get them. Nothing is ever dropped silently.
 */
export const screenshotContent = (
  result: GetScreenshotResult,
  budgetBytes = INLINE_IMAGE_BUDGET_BYTES,
): ScreenshotContent[] => {
  const blocks: ScreenshotContent[] = [];
  /** Fit nowhere in the remaining budget, but would fit a call of their own. */
  const deferred: string[] = [];
  /** Exceed the whole budget alone — a follow-up call would fail identically. */
  const oversized: string[] = [];
  let spent = 0;

  for (const img of result.images) {
    if (img.base64 === null) {
      blocks.push({ type: 'text', text: `${img.nodeId}: not exportable` });
      continue;
    }
    const emptyNote = img.empty
      ? ' — ⚠ empty (node renders nothing even unclipped: hidden / no content)'
      : img.recovered
        ? ' — ↺ recovered (clipped/off-canvas; rendered at intrinsic bounds)'
        : '';
    // Raster size + scale in the label anchors raster px ↔ design px (vital once the scale is
    // auto-fitted). Absent on SVG and on results from an older plugin build — degrade to the bare label.
    const dims =
      img.width !== undefined && img.height !== undefined
        ? ` ${img.width}×${img.height}px${img.scale !== undefined ? ` @${img.scale}x` : ''}`
        : '';
    const mimeType = RASTER_MIME[img.format];
    // SVG carries its payload in the label block itself; rasters split into label + image. Either
    // way the label is emitted unconditionally and only the payload is subject to the budget.
    const payload: ScreenshotContent =
      mimeType === undefined
        ? {
            type: 'text',
            text: `${img.nodeId} (${img.format})${emptyNote}:\n${Buffer.from(img.base64, 'base64').toString('utf8')}`,
          }
        : { type: 'image', data: img.base64, mimeType };

    const size = blockBytes(payload);
    if (spent + size > budgetBytes) {
      // Distinguish *why* it did not fit. One that overflows an empty budget is oversized on its
      // own, so re-requesting it alone would fail identically — telling the model to split the call
      // there would send it round a loop. One that merely did not fit the remainder is fine alone.
      (size > budgetBytes ? oversized : deferred).push(img.nodeId);
      blocks.push({
        type: 'text',
        text: `${img.nodeId} (${img.format}${dims})${emptyNote} — not inlined, see note below`,
      });
      continue;
    }
    spent += size;
    if (mimeType !== undefined) {
      blocks.push({ type: 'text', text: `${img.nodeId} (${img.format}${dims})${emptyNote}` });
    }
    blocks.push(payload);
  }

  if (deferred.length > 0 || oversized.length > 0) {
    // One instruction per cause, so every named id has a remedy that actually works for it.
    const remedies = [
      // Two ways out, because the right one depends on why the batch was asked for. Splitting keeps
      // full resolution per node; a smaller `scale` keeps the whole set in one response, which is
      // what a side-by-side comparison actually needs. The model knows its own intent — offer both.
      deferred.length > 0
        ? `Re-request ${deferred.join(', ')} in a follow-up call with fewer ids, or repeat the ` +
          'whole call with a smaller `scale` to fit every node in one response at lower detail.'
        : '',
      oversized.length > 0
        ? `${oversized.join(', ')} exceeded the whole budget alone, so splitting the call will ` +
          'not help — re-request with a smaller `scale`, or use `save_screenshots` to write the ' +
          'full-resolution file to disk and read it from there.'
        : '',
    ].filter(part => part !== '');
    const missed = deferred.length + oversized.length;
    // Count against what was actually exported, not what was asked for: a node that produced
    // nothing is reported on its own line and was never a candidate for inlining, so folding it
    // into this denominator would overstate how much the budget withheld.
    const exported = result.images.filter(img => img.base64 !== null).length;
    blocks.push({
      type: 'text',
      text:
        `⚠ ${missed} of ${exported} export(s) were not inlined. Sending them would have exceeded ` +
        'what an MCP client can read in one response and closed the connection. ' +
        remedies.join(' '),
    });
  }

  if (blocks.length === 0) blocks.push({ type: 'text', text: 'No nodes exported.' });
  return blocks;
};
