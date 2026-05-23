import * as v from 'valibot';

export const RpcRequestSchema = v.object({
  requestId: v.string(),
  toolName: v.string(),
  args: v.optional(v.unknown()),
});
export type RpcRequest = v.InferOutput<typeof RpcRequestSchema>;

export const RpcOkResponseSchema = v.object({
  kind: v.literal('ok'),
  requestId: v.string(),
  result: v.unknown(),
});
export type RpcOkResponse = v.InferOutput<typeof RpcOkResponseSchema>;

export const RpcErrResponseSchema = v.object({
  kind: v.literal('err'),
  requestId: v.string(),
  code: v.string(),
  message: v.string(),
});
export type RpcErrResponse = v.InferOutput<typeof RpcErrResponseSchema>;

export const RpcResponseSchema = v.variant('kind', [RpcOkResponseSchema, RpcErrResponseSchema]);
export type RpcResponse = v.InferOutput<typeof RpcResponseSchema>;
