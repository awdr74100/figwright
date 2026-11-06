import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const STYLE_FIELDS = ['fill', 'stroke', 'effect', 'grid', 'text'] as const;
type StyleField = (typeof STYLE_FIELDS)[number];

// Each field maps to the node's async style-id setter (Figma deprecated the sync `*StyleId` setters),
// the property that reads the applied id back, and the kind of style it takes.
const SETTER_BY_FIELD: Record<StyleField, string> = {
  fill: 'setFillStyleIdAsync',
  stroke: 'setStrokeStyleIdAsync',
  effect: 'setEffectStyleIdAsync',
  grid: 'setGridStyleIdAsync',
  text: 'setTextStyleIdAsync',
};
const READBACK_BY_FIELD: Record<StyleField, string> = {
  fill: 'fillStyleId',
  stroke: 'strokeStyleId',
  effect: 'effectStyleId',
  grid: 'gridStyleId',
  text: 'textStyleId',
};
const STYLE_TYPE_BY_FIELD: Record<StyleField, StyleType> = {
  fill: 'PAINT',
  stroke: 'PAINT',
  effect: 'EFFECT',
  grid: 'GRID',
  text: 'TEXT',
};

export const createApplyStyleToNodeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; styleId?: unknown; field?: unknown };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('apply_style_to_node: nodeId must be a string');
    if (typeof p.styleId !== 'string')
      throw new TypeError('apply_style_to_node: styleId must be a string');
    if (!STYLE_FIELDS.includes(p.field as StyleField)) {
      throw new TypeError(`apply_style_to_node: field must be one of ${STYLE_FIELDS.join(' / ')}`);
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null) throw new Error(`apply_style_to_node: node ${p.nodeId} not found`);

    const setter = SETTER_BY_FIELD[p.field as StyleField];
    const fn = (node as unknown as Record<string, unknown>)[setter];
    if (typeof fn !== 'function') {
      throw new Error(
        `apply_style_to_node: node ${p.nodeId} cannot take a ${String(p.field)} style`,
      );
    }
    // '' removes the style. Anything else must name a style, exactly as get_styles / import_style
    // give it: the setters take an id they cannot parse — "S:none", or a real id without its trailing
    // comma — as a removal and answer ok (measured), so a typo silently stripped the node's style.
    //
    // getStyleByIdAsync matches exactly and answers null for every such id and for a deleted style
    // (measured), so a style it finds is checked against the field before it is applied. One it
    // does not find is still tried — a library style it might not report is not refused on a guess
    // — but the node's style is read back, and put back as it was when the setter did not apply the
    // id. FigJam, which has no styles, has no getStyleByIdAsync either; its "not a function" names
    // the editor.
    const setStyle = async (id: string): Promise<void> => {
      // No font load, deliberately, even for `text`. The typings say `setTextStyleIdAsync` "requires
      // the font to be loaded", which reads like the caller's job — every other text write here
      // does load first. It is not: verified in a real file, applying a text style succeeds with
      // neither the node's current face nor the style's own face loaded in the session. Being async
      // is how the setter affords that. Adding a load would be a pointless round trip.
      await (fn as (styleId: string) => Promise<void>).call(node, id);
    };
    const readStyle = (): unknown =>
      (node as unknown as Record<string, unknown>)[READBACK_BY_FIELD[p.field as StyleField]];

    const styleId = p.styleId;
    let found = true;
    if (styleId !== '') {
      const style = await figmaCtx.getStyleByIdAsync(styleId);
      if (style === null) {
        found = false;
      } else {
        const wanted = STYLE_TYPE_BY_FIELD[p.field as StyleField];
        if (style.type !== wanted) {
          throw new Error(
            `apply_style_to_node: ${styleId} is a style of type ${style.type}; field ` +
              `${String(p.field)} takes type ${wanted}`,
          );
        }
      }
    }

    const before = readStyle();
    await setStyle(styleId);
    // Read back rather than trusted: the setter answering is what used to pass for success.
    const applied = readStyle();
    if (applied !== styleId) {
      if (typeof before === 'string' && applied !== before) await setStyle(before);
      throw new Error(
        found
          ? `apply_style_to_node: Figma did not apply ${JSON.stringify(styleId)} to ${p.nodeId}'s ` +
              `${String(p.field)} — it reads ${typeof applied === 'string' ? JSON.stringify(applied) : 'mixed'}`
          : `apply_style_to_node: no style ${JSON.stringify(styleId)} in this file — pass an id ` +
              'exactly as get_styles or import_style return it (e.g. "S:5b55…,"), or "" to remove ' +
              `the style; the node's ${String(p.field)} style was left as it was`,
      );
    }

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
