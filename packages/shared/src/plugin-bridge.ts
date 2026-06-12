import { z } from 'zod';

export const PLUGIN_BRIDGE_TAG = '@figwright/bridge';

const baseFields = {
  tag: z.literal(PLUGIN_BRIDGE_TAG),
  id: z.string(),
};

export const PluginToolCallSchema = z.object({
  ...baseFields,
  kind: z.literal('tool-call'),
  method: z.string(),
  params: z.unknown().optional(),
});

export const PluginToolResultSchema = z.object({
  ...baseFields,
  kind: z.literal('tool-result'),
  result: z.unknown().optional(),
});

export const PluginToolErrorSchema = z.object({
  ...baseFields,
  kind: z.literal('tool-error'),
  code: z.string(),
  message: z.string(),
});

export const PluginBridgeMessageSchema = z.discriminatedUnion('kind', [
  PluginToolCallSchema,
  PluginToolResultSchema,
  PluginToolErrorSchema,
]);

export type PluginToolCall = z.infer<typeof PluginToolCallSchema>;
export type PluginToolResult = z.infer<typeof PluginToolResultSchema>;
export type PluginToolError = z.infer<typeof PluginToolErrorSchema>;
export type PluginBridgeMessage = z.infer<typeof PluginBridgeMessageSchema>;

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

export const createToolResult = (input: { id: string; result?: unknown }): PluginToolResult => ({
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
  return PluginBridgeMessageSchema.safeParse(raw).success;
};

// ── sandbox → UI context push ────────────────────────────────────────────────
// A one-way event the sandbox emits (on init / page change / selection change) so the UI can show
// what the plugin currently sees. Kept out of the tool-call request/response variant on purpose.

/**
 * Cap on per-node selection detail carried in a context event (selectionCount keeps the true
 * total).
 */
export const SELECTION_DETAIL_LIMIT = 25;

export const SelectionItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  width: z.number(),
  height: z.number(),
});
export type SelectionItem = z.infer<typeof SelectionItemSchema>;

export const PluginContextEventSchema = z.object({
  tag: z.literal(PLUGIN_BRIDGE_TAG),
  kind: z.literal('context'),
  fileName: z.string(),
  pageId: z.string(),
  pageName: z.string(),
  selectionCount: z.number(),
  /** Per-node detail for the first SELECTION_DETAIL_LIMIT selected nodes. */
  selection: z.array(SelectionItemSchema),
  editorType: z.string(),
  apiVersion: z.string(),
});
export type PluginContextEvent = z.infer<typeof PluginContextEventSchema>;

export const createPluginContextEvent = (
  input: Omit<PluginContextEvent, 'tag' | 'kind'>,
): PluginContextEvent => ({ tag: PLUGIN_BRIDGE_TAG, kind: 'context', ...input });

export const isPluginContextEvent = (raw: unknown): raw is PluginContextEvent => {
  if (typeof raw !== 'object' || raw === null) return false;
  if (!('tag' in raw) || (raw as { tag: unknown }).tag !== PLUGIN_BRIDGE_TAG) return false;
  return PluginContextEventSchema.safeParse(raw).success;
};
