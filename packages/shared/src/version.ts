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
// vanishes and the write reports `{ ok: true }`. Measured against the shipped releases: a v0.1.0
// plugin drops `layoutSizingHorizontal`, so "make this fill its container" reports success and
// changes nothing.
//
// **Skew warns; it never blocks.** Refusing the connection was built first and measured against a
// real old plugin, which is how the reason not to shipped itself: the plugin decides whether to keep
// retrying, and every plugin that would be refused is by definition too old to contain that
// decision. A v0.3.0 plugin re-offered the rejected handshake ~7 times a second, indefinitely — 195
// sockets in TIME_WAIT, steady state, from one Figma tab. Everything that could soften a refusal
// (stop retrying, show a banner) lives in the plugin, and so reaches only plugins that are already
// new enough not to need it. For the population this exists for, the server is the only half that
// can act at all.
//
// So the server acts by removing the *silence*, which was the actual defect — the call still runs,
// and every result carries {@linkcode pluginSkewNotice} telling the agent the result is unverified
// and the user should update. Failures carry it too: an old plugin answers METHOD_NOT_FOUND for
// every tool it predates, and unattributed that reads as "this tool is broken" rather than "your
// plugin is old" — the same misdirection as a silent wrong write, just noisier. A wrong write is
// still possible; it is no longer unattributable.
//
// This is also what MCP does at the equivalent seam, once you follow it past the version handshake:
// for optional behaviour a peer may not have, "the supporting party MUST either revert to core
// protocol behavior or reject the request" — reverting is a legitimate answer, not a lesser one. Its
// hard `UnsupportedProtocolVersionError` is reserved for a peer it genuinely cannot parse, which
// here is `PROTOCOL_VERSION`, still a refusal and still separate. (Worth noting the handshake itself
// is gone as of revision 2026-07-28: every request now carries its own version. That model relies on
// a client that can retry with a different one, which a Figma plugin cannot, so this stays a
// handshake in the shape of the earlier revisions.)
//
// Per-argument capability flags, LSP-style, are the other road not taken: they need a hand-kept
// table of which argument arrived when, and this repo knows where those end up — `PROTOCOL_VERSION`
// sat at its initial value for every release because nothing forced it to move.
// `test/plugin-contract.test.ts` is what forces this one to move.

/**
 * The version below which a plugin is missing arguments this server sends. Raise it in the same
 * change that makes older plugins wrong — a new argument on an existing tool, a changed result
 * shape, a renamed method — to the version that change will ship in.
 *
 * Nothing is blocked below it; it is the threshold at which every tool result starts carrying
 * {@linkcode pluginSkewNotice}. Keeping a threshold rather than warning on any difference is what
 * keeps the warning meaningful: a plugin one patch behind a server that changed no arguments is
 * fine, and crying wolf there would teach an agent to discount the warning that matters.
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
 * decides what an unidentifiable peer means (the relay treats it as skewed and warns).
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

/**
 * The warning shown when a plugin predates the server.
 *
 * It has to say what may be wrong rather than only that versions differ, because the failure it
 * describes has no symptom: a handler that predates an argument ignores it and still answers `{ ok:
 * true }`, so a write can report success having done something else. Saying exactly that is the
 * whole mechanism — nothing here blocks the call.
 *
 * Written for an agent **and** for a person, because it is shown to both: appended to tool results,
 * and rendered in the plugin's own panel. One audience-neutral string rather than two, following
 * `editorLimitation` — the repo's existing warning of this shape, which manages the same trick by
 * stating the consequence and then the action, and never referring to its reader in the third
 * person. An earlier draft said "tell the user to update", which reads as nonsense in the panel,
 * where the reader _is_ the user. Caught by looking at it in Figma.
 */
export const pluginSkewNotice = (pluginVersion: string, serverVersion: string): string =>
  // `v`-prefixed only when it is really a version. Whatever the peer claimed is echoed as-is
  // otherwise, because an unreadable one dressed up as a version reads as `vnightly`.
  `Figwright plugin ${parse(pluginVersion) === null ? `"${pluginVersion}"` : `v${pluginVersion}`} ` +
  `is older than this server (v${serverVersion}). ` +
  'Arguments added after the plugin was built are silently ignored by it, so an edit can report ' +
  'success having applied only part of what was asked, and results can be incomplete — treat this ' +
  'result as unverified. Update the plugin: download the latest release from ' +
  'https://github.com/awdr74100/figwright/releases/latest and re-import it in Figma ' +
  '(Plugins → Development → Import plugin from manifest).';

/**
 * The threshold this server can honestly apply: never newer than the server itself.
 *
 * `MIN_PLUGIN_VERSION` names a release that may not exist yet — it is raised in the change that
 * breaks compatibility, which is always some commits ahead of the release that carries it. In that
 * window `packages/mcp/package.json` still holds the _previous_ version, and both halves built from
 * that tree report it, so an uncapped threshold would have the dev server warn about the dev plugin
 * it was built alongside — a warning that is not just noise but actively false. Capping at the
 * server's own version says the only sound thing: a plugin of this server's generation is in
 * lockstep with it, whatever the threshold aspires to.
 */
export const requiredPluginVersion = (serverVersion: string): string => {
  const order = compareVersions(MIN_PLUGIN_VERSION, serverVersion);
  if (order === null) return MIN_PLUGIN_VERSION;
  return order <= 0 ? MIN_PLUGIN_VERSION : serverVersion;
};

/**
 * Does a plugin reporting `pluginVersion` act on everything a server on `serverVersion` sends?
 * False means its results carry {@linkcode pluginSkewNotice}; nothing is refused either way.
 */
export const checkPluginCompatibility = (pluginVersion: string, serverVersion: string): boolean => {
  const order = compareVersions(pluginVersion, requiredPluginVersion(serverVersion));
  // An unparseable version is not a build this product ships. Warn rather than assume it is fine:
  // the whole point is that skew is never silent, and a version we cannot read is not evidence of
  // anything.
  return order !== null && order >= 0;
};
