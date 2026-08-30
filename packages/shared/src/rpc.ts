import { z } from 'zod';

export const RpcRequestSchema = z.object({
  requestId: z.string(),
  toolName: z.string(),
  args: z.unknown().optional(),
  // Pins this call to a specific plugin session on the leader. A follower running a multi-call tool
  // (e.g. component_map) resolves the active session once, then sends every sub-call with the same
  // sessionId so they can't drift to different plugins mid-flight. Absent = route to most-active.
  sessionId: z.string().optional(),
  /**
   * The caller's build stamp — the same value /ping advertises and /abdicate compares, so this
   * envelope orders its two ends the way the election already orders them.
   *
   * It exists so the leader knows whether its own tool schemas are authoritative for this call.
   * Servers on either side of a release can talk to each other: the newest build normally wins the
   * port, but an older leader that is continuously busy keeps it, and then a newer follower's
   * arguments would be checked against schemas that predate them. A caller declaring a strictly
   * newer build has already validated against better ones.
   *
   * Absent means 0 — an unbundled process, or something that is not a Figwright follower at all.
   * Both are the oldest thing in the room by that rule, which is the safe direction: their
   * arguments are the ones worth checking.
   */
  buildId: z.number().optional(),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcOkResponseSchema = z.object({
  kind: z.literal('ok'),
  requestId: z.string(),
  result: z.unknown(),
  // Set by the leader when the plugin that served this call is older than the server. Only the
  // leader holds the relay, so a follower has no other way to learn it — and the warning has to
  // reach whoever is actually calling tools, whichever role their process ended up in.
  notice: z.string().optional(),
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
