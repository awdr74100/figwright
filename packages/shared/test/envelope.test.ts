import { describe, expect, it } from 'vitest';

import {
  createError,
  createEvent,
  createRequest,
  createResponse,
  EnvelopeSchema,
} from '../src/envelope.js';
import { ErrorCode, PROTOCOL_VERSION } from '../src/protocol.js';
import { parse } from 'valibot';

const baseInput = { id: 'req-1', sessionId: 'sess-1', ts: 1_000 };

describe('envelope factories', () => {
  it('createRequest produces a valid req envelope', () => {
    const env = createRequest({ ...baseInput, method: 'foo', params: { bar: 1 } });
    expect(env).toEqual({
      v: PROTOCOL_VERSION,
      kind: 'req',
      id: 'req-1',
      sessionId: 'sess-1',
      ts: 1_000,
      method: 'foo',
      params: { bar: 1 },
    });
    expect(parse(EnvelopeSchema, env)).toEqual(env);
  });

  it('omits params when undefined (exactOptionalPropertyTypes friendly)', () => {
    const env = createRequest({ ...baseInput, method: 'foo' });
    expect('params' in env).toBe(false);
  });

  it('createResponse + createError + createEvent all round-trip through schema', () => {
    const res = createResponse({ ...baseInput, result: { ok: true } });
    const err = createError({
      ...baseInput,
      code: ErrorCode.MethodNotFound,
      message: 'no such method',
    });
    const evt = createEvent({ ...baseInput, method: 'tick' });
    expect(parse(EnvelopeSchema, res).kind).toBe('res');
    expect(parse(EnvelopeSchema, err).kind).toBe('err');
    expect(parse(EnvelopeSchema, evt).kind).toBe('evt');
  });

  it('rejects envelope with wrong protocol version', () => {
    const env = { ...createRequest({ ...baseInput, method: 'foo' }), v: '9.9.9' };
    expect(() => parse(EnvelopeSchema, env)).toThrow(Error);
  });

  it('rejects envelope with unknown kind', () => {
    const env = { ...createRequest({ ...baseInput, method: 'foo' }), kind: 'nope' };
    expect(() => parse(EnvelopeSchema, env)).toThrow(Error);
  });

  it('rejects err envelope missing required error field', () => {
    const env = { ...createRequest({ ...baseInput, method: 'foo' }), kind: 'err' };
    expect(() => parse(EnvelopeSchema, env)).toThrow(Error);
  });
});
