/**
 * `table[key]` when the table itself owns `key`, else undefined.
 *
 * For lookup tables kept as plain objects and indexed by a name that arrives from outside — a
 * method or tool name over the relay, a stroke kind in a tool's arguments. Plain bracket access
 * walks the prototype chain, so a name like `constructor`, `toString` or `__proto__` returns an
 * Object.prototype member instead of undefined, which slips past an `=== undefined` check and gets
 * called or spread as if it were a table entry.
 *
 * `Object.prototype.hasOwnProperty.call` rather than `Object.hasOwn`: the two answer identically
 * here, and this one predates every engine Figma could run the sandbox on, where a newer runtime
 * API missing from the host would fail every lookup rather than just the bad ones.
 */
export const ownValue = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
