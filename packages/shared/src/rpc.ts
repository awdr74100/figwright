import { z } from 'zod';

export const RpcRequestSchema = z.object({
  requestId: z.string(),
  toolName: z.string(),
  args: z.unknown().optional(),
  // Pins this call to a specific plugin session on the leader. A follower running a multi-call tool
  // (e.g. component_map) resolves the active session once, then sends every sub-call with the same
  // sessionId so they can't drift to different plugins mid-flight. Absent = route to most-active.
  sessionId: z.string().optional(),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcOkResponseSchema = z.object({
  kind: z.literal('ok'),
  requestId: z.string(),
  result: z.unknown(),
});
export type RpcOkResponse = z.infer<typeof RpcOkResponseSchema>;

export const RpcErrResponseSchema = z.object({
  kind: z.literal('err'),
  requestId: z.string(),
  code: z.string(),
  message: z.string(),
});
export type RpcErrResponse = z.infer<typeof RpcErrResponseSchema>;

export const RpcResponseSchema = z.discriminatedUnion('kind', [
  RpcOkResponseSchema,
  RpcErrResponseSchema,
]);
export type RpcResponse = z.infer<typeof RpcResponseSchema>;
