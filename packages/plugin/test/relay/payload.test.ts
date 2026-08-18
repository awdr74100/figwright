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

  it('elides raw export bytes without letting JSON expand them per byte', () => {
    // Regression guard: a Uint8Array has no toJSON, so an unguarded JSON.stringify turns a 4.4MB
    // export into a 51MB string and ~375ms of work on the thread that draws the panel.
    const bytes = new Uint8Array(64_000);
    const started = Date.now();
    const p = summarizePayload({ images: [{ nodeId: '1:2', base64: null, bytes }] });
    expect(p.preview).toContain('bytes elided');
    expect(p.preview).not.toMatch(/"0":\s*0/);
    // The preview stays proportional to the structure, not to the payload's byte count.
    expect(p.preview.length).toBeLessThan(500);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('counts binary by its real byteLength, not by the elision placeholder', () => {
    const bytes = new Uint8Array(50_000);
    const withBinary = summarizePayload({ nodeId: '1:2', bytes });
    const withoutBinary = summarizePayload({ nodeId: '1:2' });
    // bytes reflect what actually crossed the wire — a msgpack `bin` costs its byteLength.
    expect(withBinary.bytes - withoutBinary.bytes).toBeGreaterThanOrEqual(50_000);
    expect(withBinary.bytes).toBeLessThan(60_000);
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
