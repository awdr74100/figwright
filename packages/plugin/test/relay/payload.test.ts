import { describe, expect, it } from 'vitest';

import { LONG_STRING_THRESHOLD, PREVIEW_CAP, summarizePayload } from '../../ui/relay/payload.js';

describe('summarizePayload', () => {
  it('pretty-prints a small result and reports its byte size', () => {
    const p = summarizePayload({ ok: true, nodeId: '3:21' });
    expect(p.truncated).toBe(false);
    expect(p.preview).toContain('"nodeId": "3:21"');
    expect(p.preview).toBe(JSON.stringify({ ok: true, nodeId: '3:21' }, null, 2));
    expect(p.bytes).toBe(JSON.stringify({ ok: true, nodeId: '3:21' }).length);
  });

  it('elides long binary-ish strings (base64) from the preview but counts them in bytes', () => {
    const base64 = 'A'.repeat(LONG_STRING_THRESHOLD + 5000);
    const p = summarizePayload({ images: [{ nodeId: '1:2', base64 }] });
    expect(p.preview).not.toContain(base64);
    expect(p.preview).toContain('chars elided');
    // bytes reflect the full payload that crossed to the LLM, including the elided string.
    expect(p.bytes).toBeGreaterThan(LONG_STRING_THRESHOLD);
    // short strings are kept verbatim
    expect(p.preview).toContain('"nodeId": "1:2"');
  });

  it('caps the preview and flags truncation for an oversized result', () => {
    // Many short strings → no per-string elision, but a huge total that must be capped.
    const big = Array.from({ length: 20_000 }, (_, i) => `item-${i}`);
    const p = summarizePayload({ big });
    expect(p.truncated).toBe(true);
    expect(p.preview.length).toBeLessThanOrEqual(PREVIEW_CAP + 40);
    expect(p.preview).toContain('truncated');
  });

  it('falls back to a string for a non-serializable (circular) result', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const p = summarizePayload(circular);
    expect(typeof p.preview).toBe('string');
    expect(p.truncated).toBe(false);
  });
});
