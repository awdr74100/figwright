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
});
export type HelloResult = z.infer<typeof HelloResultSchema>;

/**
 * Params for the plugin → leader `$activity` event. Sent when sandbox emits a context push
 * (selection / page change). Carries enough file/page identity so the leader can advertise "you are
 * routed to file X, page Y" back through `ping` for multi-plugin debugging.
 */
export const ActivityParamsSchema = z.object({
  fileName: z.string(),
  pageId: z.string(),
  pageName: z.string(),
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
