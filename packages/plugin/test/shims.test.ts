import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const nativeBigInt = globalThis.BigInt;
const global = globalThis as { BigInt?: unknown };

// shims.ts acts on import, so each case resets the module graph and imports it fresh. It has
// no exports, so TypeScript reads it as a script and rejects a literal import of it; a
// specifier held in a variable is resolved at run time instead.
const SHIMS = '../src/shims.js';
const loadShims = async () => {
  vi.resetModules();
  await import(SHIMS);
};

describe('sandbox shims: BigInt', () => {
  afterEach(() => {
    global.BigInt = nativeBigInt;
  });

  it("restores the engine's own BigInt where the global is missing, as Figma's Developer VM leaves it", async () => {
    delete global.BigInt;
    await loadShims();
    // Identity, not just something callable: a stand-in that returned a Number would pass
    // `typeof` checks on the function but silently break multipleOf, coercion and values
    // past 2^53.
    expect(global.BigInt).toBe(nativeBigInt);
    expect(BigInt('9007199254740993')).toBe(9007199254740993n);
  });

  it('leaves a BigInt the environment already provides untouched', async () => {
    const provided = (value: unknown) => value;
    global.BigInt = provided;
    await loadShims();
    expect(global.BigInt).toBe(provided);
  });
});

// zod calls BigInt(...) while its module loads, so the repair only works if the shim runs
// first. That order is decided by the bundler from the entry's imports, so check the build.
const SANDBOX_BUNDLE = join(import.meta.dirname, '..', 'dist', 'code.js');

describe.skipIf(!existsSync(SANDBOX_BUNDLE))('sandbox bundle (built dist)', () => {
  it('runs the BigInt shim before the first BigInt call', () => {
    const bundle = readFileSync(SANDBOX_BUNDLE, 'utf8');
    const shim = bundle.indexOf('globalThis.BigInt');
    const firstCall = bundle.indexOf('BigInt(');
    expect(shim).toBeGreaterThanOrEqual(0);
    expect(firstCall).toBeGreaterThan(shim);
  });
});
