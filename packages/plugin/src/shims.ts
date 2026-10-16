// Repairs to the sandbox's global environment. This module must be the first import of
// the sandbox entry, so every repair is in place before any dependency loads.
//
// A shim belongs here only when a real Figma environment lacks a standard global that a
// dependency needs. Each one checks for the global first and leaves a native one alone,
// and restores the engine's real implementation where it can rather than imitating it.

// Figma's Developer VM (Plugins → Development → Use Developer VM) runs the sandbox in
// the browser's engine behind a global allowlist that leaves out `BigInt`, so the name
// resolves to undefined there even though the engine supports bigints. zod evaluates
// `BigInt(...)` while its module loads (the int64/uint64 bounds), which throws
// "TypeError: BigInt is not a function" and kills the plugin before it starts. The
// default sandbox exposes `BigInt`, and this is a no-op there.
// A bigint literal is syntax, not a global lookup, so its constructor is the engine's
// real `BigInt`.
if (typeof (globalThis as { BigInt?: unknown }).BigInt !== 'function') {
  Object.defineProperty(globalThis, 'BigInt', {
    value: 0n.constructor,
    writable: true,
    configurable: true,
  });
}
