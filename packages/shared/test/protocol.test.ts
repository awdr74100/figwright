import { afterEach, describe, expect, it, vi } from 'vitest';

import { newId } from '../src/protocol.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newId', () => {
  it('uses randomUUID where the platform has it (Node, a secure context)', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-from-platform' });
    expect(newId()).toBe('uuid-from-platform');
  });

  it('takes 128 bits from getRandomValues where randomUUID is absent — the plugin UI', () => {
    // What Figma's plugin UI offers, measured in the desktop app: a `data:` document outside a
    // secure context has getRandomValues and no randomUUID.
    // Bound before stubbing: once stubbed, globalThis.crypto is the stub itself. Typed by hand:
    // this package compiles without DOM or Node globals.
    const webCrypto = (
      globalThis as unknown as { crypto: { getRandomValues(a: Uint8Array): Uint8Array } }
    ).crypto;
    const platform = webCrypto.getRandomValues.bind(webCrypto);
    const getRandomValues = vi.fn<(a: Uint8Array) => Uint8Array>(a => platform(a));
    vi.stubGlobal('crypto', { getRandomValues });

    const ids = Array.from({ length: 200 }, () => newId());

    for (const id of ids) expect(id).toMatch(/^id-[0-9a-f]{32}$/);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getRandomValues).toHaveBeenCalledTimes(ids.length);
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(16);
  });

  it('encodes every byte as two hex digits, leading zeros included', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (a: Uint8Array) => a.fill(0x0a),
    });
    expect(newId()).toBe(`id-${'0a'.repeat(16)}`);
  });

  it('never throws where there is no crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newId()).toMatch(/^id-[0-9a-z]+-[0-9a-z]+$/);
  });
});
