import { z } from 'zod';

import { ErrorCode, PROTOCOL_VERSION } from './protocol.js';

const baseFields = {
  // Accept any version here rather than a strict literal: a peer on a different protocol must still be
  // able to *decode* our messages (and we theirs) so a mismatch surfaces as a clear error at the
  // $hello handshake instead of a cryptic envelope-decode failure. Compatibility is gated once, in the
  // relay's hello handler — not per-envelope. We still stamp our own PROTOCOL_VERSION via create*.
  v: z.string(),
  id: z.string(),
  ts: z.number(),
  sessionId: z.string(),
};

export const RequestEnvelopeSchema = z.object({
  ...baseFields,
  kind: z.literal('req'),
  method: z.string(),
  params: z.unknown().optional(),
});

export const ResponseEnvelopeSchema = z.object({
  ...baseFields,
  kind: z.literal('res'),
  result: z.unknown().optional(),
});

export const ErrorEnvelopeSchema = z.object({
  ...baseFields,
  kind: z.literal('err'),
  error: z.object({
    code: z.string(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
});

export const EventEnvelopeSchema = z.object({
  ...baseFields,
  kind: z.literal('evt'),
  method: z.string(),
  params: z.unknown().optional(),
});

export const EnvelopeSchema = z.discriminatedUnion('kind', [
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  ErrorEnvelopeSchema,
  EventEnvelopeSchema,
]);

export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
export type Envelope = z.infer<typeof EnvelopeSchema>;

export const HelloParamsSchema = z.object({
  clientType: z.enum(['plugin']),
  clientVersion: z.string(),
  // String, not a literal: a version-mismatched plugin must still parse so the relay can reject it
  // with a clear ProtocolMismatch message (see relay.handleHello), not a generic schema-parse failure.
  protocolVersion: z.string(),
});
export type HelloParams = z.infer<typeof HelloParamsSchema>;

export const HelloResultSchema = z.object({
  serverVersion: z.string(),
  protocolVersion: z.string(),
  sessionResumed: z.boolean(),
  // Set when this plugin predates the server: it is served anyway, but its results are unreliable.
  // A plugin old enough to lack this field ignores it (the client casts rather than parses), which
  // is the point — it costs nothing to send and lets any plugin new enough say so in its panel.
  skewNotice: z.string().optional(),
  /**
   * This server reads `ActivityParams.foreground`, so the plugin may report its file identity from
   * a background tab without that being taken as a claim on routing.
   *
   * Negotiated here rather than inferred from `serverVersion` for two reasons. A version comparison
   * would need a constant naming the release this shipped in, which does not exist yet while it is
   * being written — both halves of a dev tree report the previous version, so the plugin would take
   * the compatibility path against the very server that understands it, and the new path would go
   * untested by hand. And it is the wrong question: what matters is whether this peer acts on the
   * field, which is exactly what it can say for itself.
   *
   * Absent means an older server, which ignores unknown params. Against one, a background tab must
   * go back to staying silent: that server reads any activity event as a routing claim, so
   * announcing identity from a hidden tab would let a background file steal the agent — the bug the
   * visibility gate was added to fix.
   */
  foregroundFlag: z.boolean().optional(),
});
export type HelloResult = z.infer<typeof HelloResultSchema>;

/**
 * Params for the plugin → leader `$activity` event. Sent when the sandbox emits a context push
 * (open / selection / page change). Carries enough file/page identity so the leader can advertise
 * "you are routed to file X, page Y" back through `ping` for multi-plugin debugging.
 *
 * The event answers two separate questions, and conflating them was a bug worth a note. _Which file
 * is this?_ is always true and always worth recording. _Should this file win routing?_ is only true
 * for the tab the user is actually looking at — a background tab that claimed it would steal the
 * agent out from under them. The event used to answer only the second, by not being sent at all
 * from a background tab, which meant the leader knew nothing about any file the user had not
 * recently been in: `fileName` stayed null for every session that had merely connected.
 * `foreground` splits them, so identity can be reported unconditionally while routing stays gated.
 */
export const ActivityParamsSchema = z.object({
  fileName: z.string(),
  pageId: z.string(),
  pageName: z.string(),
  /**
   * Whether this plugin's tab was in the foreground when the event fired — the routing signal.
   *
   * Optional because a plugin that predates it never sends one, and such a plugin only ever emitted
   * from a visible tab: absent therefore means the same thing as true, which is what the leader
   * treats it as. `document.visibilityState` is the only reliable source for it; window `focus`
   * fires on every open tab at once and was measured stealing routing to background files.
   */
  foreground: z.boolean().optional(),
});
export type ActivityParams = z.infer<typeof ActivityParamsSchema>;

type CreateInput = {
  id: string;
  sessionId: string;
  ts?: number;
};

export const createRequest = (
  input: CreateInput & { method: string; params?: unknown },
): RequestEnvelope => ({
  v: PROTOCOL_VERSION,
  kind: 'req',
  id: input.id,
  sessionId: input.sessionId,
  ts: input.ts ?? Date.now(),
  method: input.method,
  ...(input.params === undefined ? {} : { params: input.params }),
});

export const createResponse = (input: CreateInput & { result?: unknown }): ResponseEnvelope => ({
  v: PROTOCOL_VERSION,
  kind: 'res',
  id: input.id,
  sessionId: input.sessionId,
  ts: input.ts ?? Date.now(),
  ...(input.result === undefined ? {} : { result: input.result }),
});

export const createError = (
  input: CreateInput & { code: ErrorCode | string; message: string; data?: unknown },
): ErrorEnvelope => ({
  v: PROTOCOL_VERSION,
  kind: 'err',
  id: input.id,
  sessionId: input.sessionId,
  ts: input.ts ?? Date.now(),
  error: {
    code: input.code,
    message: input.message,
    ...(input.data === undefined ? {} : { data: input.data }),
  },
});

export const createEvent = (
  input: CreateInput & { method: string; params?: unknown },
): EventEnvelope => ({
  v: PROTOCOL_VERSION,
  kind: 'evt',
  id: input.id,
  sessionId: input.sessionId,
  ts: input.ts ?? Date.now(),
  method: input.method,
  ...(input.params === undefined ? {} : { params: input.params }),
});
