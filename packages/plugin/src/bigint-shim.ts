// Figma's plugin sandbox can ship without a callable `BigInt`. zod v4 evaluates
// `BigInt(...)` while its module loads (the int64/uint64 bounds), which throws
// "TypeError: BigInt is not a function" and kills the plugin before it starts.
// This module must be the first import of the sandbox entry so it runs before zod loads.
// The stub only needs to satisfy that load-time evaluation: it returns a Number, so
// `typeof x === 'bigint'` stays false and the int64/uint64 schemas are never used here.
if (typeof (globalThis as { BigInt?: unknown }).BigInt !== 'function') {
  Object.defineProperty(globalThis, 'BigInt', {
    value: (value: unknown): number => Number(value),
    writable: true,
    configurable: true,
  });
}
