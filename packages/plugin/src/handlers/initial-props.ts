import type { SandboxToolHandler } from '../dispatcher.js';
import { createSetAutoLayoutHandler } from './set-auto-layout.js';
import { createSetCornerRadiusHandler } from './set-corner-radius.js';
import { createSetFillsHandler } from './set-fills.js';
import { createSetLayoutPropsHandler } from './set-layout-props.js';
import { createSetStrokesHandler } from './set-strokes.js';
import { createSetTextPropertiesHandler } from './set-text-properties.js';

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
  'textTruncation',
  'maxLines',
  'textAutoResize',
] as const;

const pick = (source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter(k => source[k] !== undefined).map(k => [k, source[k]]));

/**
 * Apply the style a create_* call asked for, by running the very handlers set_fills / set_strokes /
 * set_corner_radius / set_auto_layout / set_layout_props / set_text_properties run — so a field
 * means the same thing at creation as afterwards, and their validation and quirks come along.
 *
 * Runs after the node is placed: FILL sizing needs its auto-layout parent, and auto layout must be
 * on before HUG means anything. If any step throws, the half-built node is removed so a refused
 * create never leaves a styled-wrong layer behind, and the error says which step it was.
 */
export const applyInitialProps = async (
  figmaCtx: typeof figma,
  node: SceneNode,
  params: Record<string, unknown>,
  tool: string,
): Promise<void> => {
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
  const layout = pick(params, ['layoutSizingHorizontal', 'layoutSizingVertical', 'clipsContent']);
  if (Object.keys(layout).length > 0) {
    steps.push(['layout', createSetLayoutPropsHandler(figmaCtx), { nodeId, ...layout }]);
  }
  const text = pick(params, TEXT_KEYS);
  if (Object.keys(text).length > 0) {
    steps.push(['text', createSetTextPropertiesHandler(figmaCtx), { nodeId, ...text }]);
  }

  for (const [label, handler, args] of steps) {
    try {
      // eslint-disable-next-line no-await-in-loop -- each step builds on the one before
      await handler(args);
    } catch (error) {
      node.remove();
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${tool}: ${label} — ${reason} (the new layer was removed)`, {
        cause: error,
      });
    }
  }
};
