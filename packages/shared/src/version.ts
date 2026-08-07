// Server ↔ plugin compatibility.
//
// The two halves of Figwright ship on one version (the `vX.Y.Z` tag; `packages/plugin/vite.config.ts`
// bakes `packages/mcp/package.json`'s version into the plugin bundle) but through different channels:
// the server updates itself via `npx @figwright/mcp@latest`, while the plugin is a zip the user
// imports by hand and then never thinks about again. Skew is therefore the *default* state, not an
// edge case.
//
// It bites in a way no gate here can see. Tool arguments are validated on the server (Zod, in
// `tools/`) and read positionally by the sandbox handler (`const p = params as { … }`), so a server
// that sends an argument an older handler never destructures gets no error — the field simply
// vanishes and the write reports `{ ok: true }`. Measured against the shipped releases: a v0.3.0
// plugin drops `get_screenshot`'s `forVision`, which is the cap that keeps a raster inside the
// model's context window, so the screenshot comes back at full scale and can take the connection
// down on the 10MB stdio ceiling.
//
// MCP settles the equivalent question by refusing rather than guessing: a peer asking for a version
// the other does not implement gets `UnsupportedProtocolVersionError` carrying what is supported and
// what was requested, and if nothing is mutually supported the client surfaces the error to the
// user. MIN_PLUGIN_VERSION is that idea applied to the implementation version: the oldest plugin
// this server will talk to.
//
// Where it deliberately diverges: as of revision 2026-07-28 MCP has no negotiation handshake at all
// — every request carries its own version and is accepted or rejected on its own. That works because
// an MCP client can retry with a different version. This relay is a stateful session (the plugin
// connects once and is dispatched to for as long as the panel is open) and the plugin has nothing to
// fall back to, so the question is settled once, at `$hello`, in the shape of the earlier
// handshake-based revisions.
//
// Capabilities are also deliberately not used. They exist for features a peer may legitimately never
// have (sampling, roots; extensions in the modern revision), and the rule there is that the
// supporting side reverts to core behaviour or rejects. A plugin missing `layoutSizingHorizontal` is
// not declining an option, it is one product at an older version — what a floor is for. Per-argument
// flags would also need a hand-kept table of which argument arrived when, and this repo knows where
// those end up: `PROTOCOL_VERSION` sat at its initial value for every release because nothing forced
// it to move. `test/plugin-contract.test.ts` is what forces this one to move.

/**
 * Oldest plugin build this server accepts. Raise it in the same change that makes older plugins
 * wrong — a new argument on an existing tool, a changed result shape, a renamed method — to the
 * version that change will ship in.
 *
 * Raising it locks out every plugin below it until the user re-imports, so it buys correctness with
 * the user's time: raise it for a silent-wrong-answer bug, not for a feature they can live
 * without.
 */
export const MIN_PLUGIN_VERSION = '0.4.0';

const parse = (version: string): { core: [number, number, number]; pre: string | null } | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(version);
  if (match === null) return null;
  const [, major, minor, patch, pre] = match;
  if (major === undefined || minor === undefined || patch === undefined) return null;
  return { core: [Number(major), Number(minor), Number(patch)], pre: pre ?? null };
};

// Semver precedence for the subset of versions this product can produce: numeric core, then
// prerelease < release, then dot-separated prerelease identifiers (numeric compare numerically and
// rank below alphanumeric ones). Build metadata is ignored, per spec.
const comparePre = (a: string, b: string): number => {
  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) {
      if (Number(l) !== Number(r)) return Number(l) < Number(r) ? -1 : 1;
    } else if (lNum !== rNum) {
      return lNum ? -1 : 1;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
};

/**
 * Compare two semver strings: negative if `a` precedes `b`, 0 if equal, positive if `a` follows.
 * Returns `null` when either side is not a version this product could have produced — the caller
 * decides what an unidentifiable peer means (the relay refuses it).
 */
export const compareVersions = (a: string, b: string): number | null => {
  const left = parse(a);
  const right = parse(b);
  if (left === null || right === null) return null;
  // Unrolled rather than looped: a literal index into the fixed-length core is a `number`, where a
  // loop variable would be `number | undefined` under noUncheckedIndexedAccess.
  if (left.core[0] !== right.core[0]) return left.core[0] < right.core[0] ? -1 : 1;
  if (left.core[1] !== right.core[1]) return left.core[1] < right.core[1] ? -1 : 1;
  if (left.core[2] !== right.core[2]) return left.core[2] < right.core[2] ? -1 : 1;
  if (left.pre === null && right.pre === null) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return comparePre(left.pre, right.pre);
};

export interface PluginCompatibility {
  compatible: boolean;
  /** The floor actually applied — see `requiredPluginVersion`. */
  required: string;
}

/**
 * The floor this server can honestly demand: never newer than the server itself.
 *
 * `MIN_PLUGIN_VERSION` names a release that may not exist yet — it is raised in the change that
 * breaks compatibility, which is always some commits ahead of the release that carries it. In that
 * window `packages/mcp/package.json` still holds the _previous_ version, and both halves built from
 * that tree report it, so an uncapped floor would have the dev server reject the dev plugin it was
 * built alongside. Capping at the server's own version says the only sound thing: a plugin that is
 * this server's generation is in lockstep with it, whatever the floor aspires to.
 */
export const requiredPluginVersion = (serverVersion: string): string => {
  const order = compareVersions(MIN_PLUGIN_VERSION, serverVersion);
  if (order === null) return MIN_PLUGIN_VERSION;
  return order <= 0 ? MIN_PLUGIN_VERSION : serverVersion;
};

/** Decide whether a plugin reporting `pluginVersion` may connect to a server on `serverVersion`. */
export const checkPluginCompatibility = (
  pluginVersion: string,
  serverVersion: string,
): PluginCompatibility => {
  const required = requiredPluginVersion(serverVersion);
  const order = compareVersions(pluginVersion, required);
  // An unparseable version is not a build this product ships; refuse rather than guess, since the
  // whole point of the gate is that skew must never proceed silently.
  return { compatible: order !== null && order >= 0, required };
};
