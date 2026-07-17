// Shared helpers for the Motion (beta) handlers: the node-capability guard, the editor gate, a
// light keyframe-field check, and a plain-JSON cloner for reads. The Motion API lives on every
// SceneNode, but only in the Figma Design editor — FigJam / Dev Mode have no animation engine.

/** A node that exposes the Motion API. Every SceneNode does; PAGE / DOCUMENT do not. */
export type MotionNode = BaseNode & MotionNodeMixin;

/** Runtime guard: the Motion mixin methods are present on scene nodes, absent on PAGE / DOCUMENT. */
export const isMotionNode = (node: BaseNode): node is MotionNode => 'applyAnimationStyle' in node;

/**
 * Motion authoring and video export only work in the Figma Design editor. Throw a clear, actionable
 * error rather than letting the plugin API reject opaquely (or silently no-op) in FigJam / Dev
 * Mode.
 */
export const assertFigmaEditor = (figmaCtx: typeof figma, tool: string): void => {
  if (figmaCtx.editorType !== 'figma') {
    throw new Error(
      `${tool}: Figma Motion is only available in the Figma Design editor (current editor: ${figmaCtx.editorType}).`,
    );
  }
};

/**
 * Light semantic check the grounded MCP schema can't express: an effects INDEXED_ITEM must carry a
 * `field` or a `propertyId`. Keeps the common PROPERTY / fills / strokes paths untouched.
 */
export const assertKeyframeField = (field: unknown, tool: string): void => {
  if (typeof field !== 'object' || field === null) {
    throw new TypeError(`${tool}: field must be an object`);
  }
  const f = field as {
    type?: unknown;
    collection?: unknown;
    field?: unknown;
    propertyId?: unknown;
  };
  if (
    f.type === 'INDEXED_ITEM' &&
    f.collection === 'effects' &&
    f.field === undefined &&
    f.propertyId === undefined
  ) {
    throw new TypeError(`${tool}: an effects INDEXED_ITEM field needs "field" or "propertyId"`);
  }
};

/**
 * Deep-clone a plugin-API structure to plain JSON. Motion's animation / keyframe objects are plain
 * data keyed by field name; this shields the RPC envelope from any live proxy the API may hand
 * back.
 */
export const toPlainJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
