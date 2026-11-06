import type { SandboxToolHandler } from '../dispatcher.js';
import { createSetAutoLayoutHandler } from './set-auto-layout.js';
import { createSetCornerRadiusHandler } from './set-corner-radius.js';
import { createSetFillsHandler } from './set-fills.js';
import { createSetLayoutPropsHandler } from './set-layout-props.js';
import { createSetStrokesHandler } from './set-strokes.js';
import { createSetTextPropertiesHandler } from './set-text-properties.js';

/** Typography, written before the layout sizing: a FIXED axis freezes the box it has right then. */
const TEXT_KEYS = [
  'fontName',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'paragraphSpacing',
  'paragraphIndent',
  'textWrapStyle',
  'textCase',
  'textDecoration',
  'textAlignHorizontal',
  'textAlignVertical',
] as const;

/**
 * The box's mode and clamp, written after the layout sizing — so where the two disagree the mode
 * wins, as it does when set_text_properties follows set_layout_props on a node already made.
 */
const TEXT_MODE_KEYS = ['textAutoResize', 'textTruncation', 'maxLines'] as const;

/**
 * A text box's size, which set_text_properties sets alongside its auto-resize. Taken for TEXT only:
 * create_frame and the shape tools have a width / height of their own, sized by `resize()`.
 */
const TEXT_BOX_KEYS = ['width', 'height'] as const;

const pick = (source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter(k => source[k] !== undefined).map(k => [k, source[k]]));

/**
 * Apply the style a create_* call asked for, by running the very handlers set_fills / set_strokes /
 * set_corner_radius / set_auto_layout / set_layout_props / set_text_properties run — so a field
 * means the same thing at creation as afterwards, and their validation and quirks come along.
 *
 * Runs after the node is placed: FILL sizing needs its auto-layout parent, auto layout must be on
 * before HUG means anything, and a text node's typography must be set before a FIXED axis freezes
 * its box. If any step throws, the half-built node is removed so a refused create never leaves a
 * styled-wrong layer behind, and the error says which step it was. Returns what a step reported as
 * not landing as asked (set_text_properties' `adjusted`), if any did.
 */
export const applyInitialProps = async (
  figmaCtx: typeof figma,
  node: SceneNode,
  params: Record<string, unknown>,
  tool: string,
): Promise<string | undefined> => {
  const nodeId = node.id;
  const steps: [string, SandboxToolHandler, Record<string, unknown>][] = [];

  if (params.fills !== undefined) {
    steps.push(['fills', createSetFillsHandler(figmaCtx), { nodeId, fills: params.fills }]);
  }
  if (params.strokes !== undefined) {
    steps.push([
      'strokes',
      createSetStrokesHandler(figmaCtx),
      { nodeId, ...pick(params, ['strokes', 'strokeWeight', 'strokeAlign']) },
    ]);
  } else if (params.strokeWeight !== undefined || params.strokeAlign !== undefined) {
    node.remove();
    throw new TypeError(
      `${tool}: strokeWeight / strokeAlign need strokes — pass the stroke paints too (the new ` +
        'layer was removed)',
    );
  }
  if (params.cornerRadius !== undefined) {
    steps.push([
      'cornerRadius',
      createSetCornerRadiusHandler(figmaCtx),
      { nodeId, radius: params.cornerRadius },
    ]);
  }
  if (params.autoLayout !== undefined) {
    steps.push([
      'autoLayout',
      createSetAutoLayoutHandler(figmaCtx),
      { nodeId, ...(params.autoLayout as Record<string, unknown>) },
    ]);
  }
  // Typography before sizing: a FIXED axis on a text node freezes its box at the size it has right
  // then (Figma switches textAutoResize to NONE), so sizing first would freeze the box the default
  // 12px font needs and let a larger fontSize overflow it. The box size goes with it, so a width
  // wraps the text before a FIXED height freezes it at the height those lines need.
  const text = pick(params, node.type === 'TEXT' ? [...TEXT_KEYS, ...TEXT_BOX_KEYS] : TEXT_KEYS);
  if (Object.keys(text).length > 0) {
    steps.push(['text', createSetTextPropertiesHandler(figmaCtx), { nodeId, ...text }]);
  }
  const layout = pick(params, ['layoutSizingHorizontal', 'layoutSizingVertical', 'clipsContent']);
  if (Object.keys(layout).length > 0) {
    steps.push(['layout', createSetLayoutPropsHandler(figmaCtx), { nodeId, ...layout }]);
  }
  const mode = pick(params, TEXT_MODE_KEYS);
  if (Object.keys(mode).length > 0) {
    steps.push(['text', createSetTextPropertiesHandler(figmaCtx), { nodeId, ...mode }]);
  }

  const adjusted: string[] = [];
  for (const [label, handler, args] of steps) {
    try {
      // eslint-disable-next-line no-await-in-loop -- each step builds on the one before
      const result = (await handler(args)) as { adjusted?: unknown } | undefined;
      if (typeof result?.adjusted === 'string') adjusted.push(result.adjusted);
    } catch (error) {
      node.remove();
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${tool}: ${label} — ${reason} (the new layer was removed)`, {
        cause: error,
      });
    }
  }
  return adjusted.length > 0 ? adjusted.join('; ') : undefined;
};
