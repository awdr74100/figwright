import { describe, expect, it } from 'vitest';

import { decodeEnvelope, encodeEnvelope } from '../src/codec.js';
import { createError, createRequest, createResponse, type ResponseEnvelope } from '../src/envelope.js';
import { ErrorCode } from '../src/protocol.js';

const baseInput = { id: 'r1', sessionId: 's1', ts: 42 };

describe('msgpack codec', () => {
  it('round-trips a request envelope', () => {
    const env = createRequest({ ...baseInput, method: 'hello', params: { a: 1, b: 'x' } });
    const bytes = encodeEnvelope(env);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(decodeEnvelope(bytes)).toEqual(env);
  });

  it('round-trips a response envelope (binary blob in result)', () => {
    const env = createResponse({ ...baseInput, result: { bin: new Uint8Array([1, 2, 3]) } });
    const decoded = decodeEnvelope(encodeEnvelope(env)) as ResponseEnvelope;
    expect(decoded.kind).toBe('res');
    const result = decoded.result as { bin: Uint8Array };
    expect(Array.from(result.bin)).toEqual([1, 2, 3]);
  });

  it('round-trips an error envelope', () => {
    const env = createError({
      ...baseInput,
      code: ErrorCode.Timeout,
      message: 'timed out',
      data: { ms: 30_000 },
    });
    expect(decodeEnvelope(encodeEnvelope(env))).toEqual(env);
  });

  it('accepts ArrayBuffer input (browser WebSocket delivery)', () => {
    const env = createRequest({ ...baseInput, method: 'noop' });
    const bytes = encodeEnvelope(env);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(decodeEnvelope(ab)).toEqual(env);
  });

  it('throws on garbage bytes', () => {
    expect(() => decodeEnvelope(new Uint8Array([0xff, 0xff, 0xff]))).toThrow(Error);
  });
});
