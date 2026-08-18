import { describe, expect, it } from 'vitest';

import { BINARY_REQUEST, binaryPayload } from '../../src/tools/binary-payload.js';

describe('binaryPayload', () => {
  it('takes the raw bytes when the plugin answered the binary request', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(binaryPayload({ base64: null, bytes })).toEqual(Buffer.from(bytes));
  });

  it('falls back to base64 for a plugin that dropped the binary flag', () => {
    expect(binaryPayload({ base64: 'iVBORw==' })).toEqual(Buffer.from('iVBORw==', 'base64'));
  });

  it('prefers bytes when a reply somehow carries both', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(binaryPayload({ base64: 'AAAA', bytes })).toEqual(Buffer.from(bytes));
  });

  it('reports nothing exported for base64 null, an absent base64, or an empty reply', () => {
    expect(binaryPayload({ base64: null })).toBeNull();
    expect(binaryPayload({})).toBeNull();
  });

  it('keeps zero-length bytes distinct from nothing exported', () => {
    // A blank-but-real export (an empty frame) must still land a file rather than a null path.
    const empty = binaryPayload({ base64: null, bytes: new Uint8Array(0) });
    expect(empty).not.toBeNull();
    expect(empty?.byteLength).toBe(0);
  });

  it('is the single flag every disk-landing tool sends', () => {
    expect(BINARY_REQUEST).toEqual({ binary: true });
  });
});
