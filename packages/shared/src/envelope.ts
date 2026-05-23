import * as v from 'valibot';

import { ErrorCode, PROTOCOL_VERSION } from './protocol.js';

const baseFields = {
  v: v.literal(PROTOCOL_VERSION),
  id: v.string(),
  ts: v.number(),
  sessionId: v.string(),
};

export const RequestEnvelopeSchema = v.object({
  ...baseFields,
  kind: v.literal('req'),
  method: v.string(),
  params: v.optional(v.unknown()),
});

export const ResponseEnvelopeSchema = v.object({
  ...baseFields,
  kind: v.literal('res'),
  result: v.optional(v.unknown()),
});

export const ErrorEnvelopeSchema = v.object({
  ...baseFields,
  kind: v.literal('err'),
  error: v.object({
    code: v.string(),
    message: v.string(),
    data: v.optional(v.unknown()),
  }),
});

export const EventEnvelopeSchema = v.object({
  ...baseFields,
  kind: v.literal('evt'),
  method: v.string(),
  params: v.optional(v.unknown()),
});

export const EnvelopeSchema = v.variant('kind', [
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  ErrorEnvelopeSchema,
  EventEnvelopeSchema,
]);

export type RequestEnvelope = v.InferOutput<typeof RequestEnvelopeSchema>;
export type ResponseEnvelope = v.InferOutput<typeof ResponseEnvelopeSchema>;
export type ErrorEnvelope = v.InferOutput<typeof ErrorEnvelopeSchema>;
export type EventEnvelope = v.InferOutput<typeof EventEnvelopeSchema>;
export type Envelope = v.InferOutput<typeof EnvelopeSchema>;

export const HelloParamsSchema = v.object({
  clientType: v.picklist(['plugin']),
  clientVersion: v.string(),
  protocolVersion: v.literal(PROTOCOL_VERSION),
});
export type HelloParams = v.InferOutput<typeof HelloParamsSchema>;

export const HelloResultSchema = v.object({
  serverVersion: v.string(),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  sessionResumed: v.boolean(),
});
export type HelloResult = v.InferOutput<typeof HelloResultSchema>;

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

export const createResponse = (
  input: CreateInput & { result?: unknown },
): ResponseEnvelope => ({
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
