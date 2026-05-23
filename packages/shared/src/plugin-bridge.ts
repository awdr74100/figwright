import * as v from 'valibot';

export const PLUGIN_BRIDGE_TAG = '@figma-mcp-relay/bridge';

const baseFields = {
  tag: v.literal(PLUGIN_BRIDGE_TAG),
  id: v.string(),
};

export const PluginToolCallSchema = v.object({
  ...baseFields,
  kind: v.literal('tool-call'),
  method: v.string(),
  params: v.optional(v.unknown()),
});

export const PluginToolResultSchema = v.object({
  ...baseFields,
  kind: v.literal('tool-result'),
  result: v.optional(v.unknown()),
});

export const PluginToolErrorSchema = v.object({
  ...baseFields,
  kind: v.literal('tool-error'),
  code: v.string(),
  message: v.string(),
});

export const PluginBridgeMessageSchema = v.variant('kind', [
  PluginToolCallSchema,
  PluginToolResultSchema,
  PluginToolErrorSchema,
]);

export type PluginToolCall = v.InferOutput<typeof PluginToolCallSchema>;
export type PluginToolResult = v.InferOutput<typeof PluginToolResultSchema>;
export type PluginToolError = v.InferOutput<typeof PluginToolErrorSchema>;
export type PluginBridgeMessage = v.InferOutput<typeof PluginBridgeMessageSchema>;

export const createToolCall = (input: {
  id: string;
  method: string;
  params?: unknown;
}): PluginToolCall => ({
  tag: PLUGIN_BRIDGE_TAG,
  kind: 'tool-call',
  id: input.id,
  method: input.method,
  ...(input.params === undefined ? {} : { params: input.params }),
});

export const createToolResult = (input: {
  id: string;
  result?: unknown;
}): PluginToolResult => ({
  tag: PLUGIN_BRIDGE_TAG,
  kind: 'tool-result',
  id: input.id,
  ...(input.result === undefined ? {} : { result: input.result }),
});

export const createToolError = (input: {
  id: string;
  code: string;
  message: string;
}): PluginToolError => ({
  tag: PLUGIN_BRIDGE_TAG,
  kind: 'tool-error',
  id: input.id,
  code: input.code,
  message: input.message,
});

export const isPluginBridgeMessage = (raw: unknown): raw is PluginBridgeMessage => {
  if (typeof raw !== 'object' || raw === null) return false;
  if (!('tag' in raw) || (raw as { tag: unknown }).tag !== PLUGIN_BRIDGE_TAG) return false;
  return v.safeParse(PluginBridgeMessageSchema, raw).success;
};

// ── sandbox → UI context push ────────────────────────────────────────────────
// A one-way event the sandbox emits (on init / page change / selection change) so the UI can show
// what the plugin currently sees. Kept out of the tool-call request/response variant on purpose.

/** Cap on per-node selection detail carried in a context event (selectionCount keeps the true total). */
export const SELECTION_DETAIL_LIMIT = 25;

export const SelectionItemSchema = v.object({
  id: v.string(),
  name: v.string(),
  type: v.string(),
  width: v.number(),
  height: v.number(),
});
export type SelectionItem = v.InferOutput<typeof SelectionItemSchema>;

export const PluginContextEventSchema = v.object({
  tag: v.literal(PLUGIN_BRIDGE_TAG),
  kind: v.literal('context'),
  fileName: v.string(),
  pageId: v.string(),
  pageName: v.string(),
  selectionCount: v.number(),
  /** Per-node detail for the first SELECTION_DETAIL_LIMIT selected nodes. */
  selection: v.array(SelectionItemSchema),
  editorType: v.string(),
  apiVersion: v.string(),
});
export type PluginContextEvent = v.InferOutput<typeof PluginContextEventSchema>;

export const createPluginContextEvent = (
  input: Omit<PluginContextEvent, 'tag' | 'kind'>,
): PluginContextEvent => ({ tag: PLUGIN_BRIDGE_TAG, kind: 'context', ...input });

export const isPluginContextEvent = (raw: unknown): raw is PluginContextEvent => {
  if (typeof raw !== 'object' || raw === null) return false;
  if (!('tag' in raw) || (raw as { tag: unknown }).tag !== PLUGIN_BRIDGE_TAG) return false;
  return v.safeParse(PluginContextEventSchema, raw).success;
};
