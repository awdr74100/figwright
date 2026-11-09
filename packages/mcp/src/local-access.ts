/**
 * Who may talk to the leader's loopback endpoints.
 *
 * Binding to 127.0.0.1 keeps the LAN out; it does not keep the user's own browser out. Two distinct
 * paths lead from a web page to a local port, and they need two distinct checks:
 *
 * - **Cross-site.** A page can open a WebSocket to a local port (WebSockets have no same-origin
 *   policy) or POST a CORS "simple request" to one. It can't read the reply, but the side effect
 *   already happened. Such a request carries an `Origin` the page cannot forge → gated by origin,
 *   and for WebSockets also by User-Agent: the plugin's origin ("null") is one any sandboxed iframe
 *   shares, while its User-Agent — the Figma desktop app's — is one no page can present.
 * - **DNS rebinding.** A page on attacker.com whose DNS re-resolves to 127.0.0.1 reaches us as
 *   _same-origin_, so a GET carries no `Origin` at all and the reply IS readable. What it cannot
 *   change is `Host`, which still names the attacker's domain → gated by host.
 *
 * The MCP security best practices ("Local MCP Server Compromise") name DNS rebinding explicitly;
 * the host gate follows the shape Playwright uses for its own local servers.
 */

/**
 * Figma renders plugin UI in a sandboxed iframe, whose serialized origin is the literal string
 * "null" (measured: a `data:` document under www.figma.com). The www/apex pair is belt-and-braces
 * for a host that ever sends a real origin instead. Not sufficient on its own — see
 * isAllowedWsOrigin.
 */
const PLUGIN_ORIGINS = new Set(['null', 'https://www.figma.com', 'https://figma.com']);

/** The names a legitimate caller can address us by. The server always binds loopback. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Escape hatch for an environment whose plugin host sends an origin we don't anticipate. Read per
 * call rather than at module load so tests (and a user editing their client config) see changes.
 * Deliberately does not lift the host gate: that set is our own bind address, not something an
 * outside party influences, so there is nothing for it to break.
 */
const allowAnyOrigin = (): boolean => process.env.FIGWRIGHT_ALLOW_ANY_ORIGIN === '1';

/**
 * Whether this process has the origin and User-Agent checks lifted. The very predicate the checks
 * use, exported so that reporting it can never disagree with enforcing it. Only meaningful in the
 * leader — the process holding the port is the one that enforces.
 */
export const isAccessGateLifted = allowAnyOrigin;

/** Strip the port, keeping an IPv6 literal's brackets intact. */
const hostnameFromHostHeader = (host: string): string => {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end < 0 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(':');
  return colon < 0 ? host : host.slice(0, colon);
};

/**
 * True when the request addressed us by a loopback name. Blocks DNS rebinding, where the browser
 * treats the call as same-origin — so no `Origin` is sent and the reply is readable — but `Host`
 * still carries the attacker's domain.
 *
 * Unconditional because Node hard-codes the 127.0.0.1 bind. If the bind host ever becomes
 * configurable, this has to become conditional on it being loopback, the way Playwright's
 * `computeAllowedHosts` disables itself when bound to a public address.
 */
export const isAllowedHost = (host: string | undefined): boolean => {
  // HTTP/1.1 requires Host; a caller omitting it is not a browser following the rules.
  if (host === undefined || host === '') return false;
  return LOOPBACK_HOSTS.has(hostnameFromHostHeader(host.toLowerCase()));
};

/**
 * The token the Figma desktop app guarantees in its User-Agent: `Figma/<version>`.
 *
 * Figma builds its UA from Electron's default (which already carries `<app name>/<version>`) and
 * then, in its own code, rewrites any `Figma<suffix>/<v>` into `Figma<suffix>/<v> Figma/<v>` — so
 * stable, Beta and every install flavour carry it, and only optional suffixes (FigmaMSI, FigmaPKG,
 * FigmaARM) differ. Measured on the desktop app's plugin handshake on macOS (arm64) and Windows
 * (x64). Matched as a token, not the full string, so no suffix and no version is required.
 */
const FIGMA_DESKTOP_UA = /(?:^|\s)Figma\/\d/;

/** True when a User-Agent header comes from the Figma desktop app. */
export const isFigmaDesktopUserAgent = (userAgent: string | undefined): boolean =>
  userAgent !== undefined && FIGMA_DESKTOP_UA.test(userAgent);

/**
 * True when a WebSocket upgrade carrying this `Origin` and `User-Agent` may become a plugin
 * session.
 *
 * The plugin runs only in the Figma desktop app (Figma allows development plugins nowhere else), so
 * a browser-origin upgrade is admitted only when it also comes from that app. The origin alone
 * cannot say so: the plugin's sandboxed UI serializes its origin as "null", and so does any
 * sandboxed iframe on any site. The User-Agent can: a page cannot set the headers of a WebSocket
 * handshake — the API takes none, and User-Agent is a forbidden header name — so a browser tab
 * always presents its own browser's UA. This rests on the same browser guarantee the origin check
 * already does.
 *
 * Not covered here: other code running inside the Figma desktop app presents the app's own UA.
 */
export const isAllowedWsOrigin = (
  origin: string | undefined,
  userAgent: string | undefined,
): boolean => classifyWsUpgrade(origin, userAgent) === 'admit';

/**
 * The same decision as isAllowedWsOrigin, naming the reason when it refuses. The two reasons call
 * for different follow-up: a foreign origin is a web page being turned away as designed; a plugin
 * origin without the desktop app's User-Agent is either a browser tab (also as designed) or — the
 * one case that needs a human — a Figma build whose User-Agent we did not anticipate.
 */
export type WsUpgradeVerdict = 'admit' | 'origin' | 'user-agent';

export const classifyWsUpgrade = (
  origin: string | undefined,
  userAgent: string | undefined,
): WsUpgradeVerdict => {
  if (allowAnyOrigin()) return 'admit';
  // Absent header: a non-browser client (a test harness, a local tool). Browsers always set Origin
  // on a WebSocket handshake, so this can't be a web page.
  if (origin === undefined || origin === '') return 'admit';
  if (!PLUGIN_ORIGINS.has(origin)) return 'origin';
  return isFigmaDesktopUserAgent(userAgent) ? 'admit' : 'user-agent';
};

/**
 * True when an HTTP request carrying this `Origin` may reach /rpc, /ping or /abdicate. Stricter
 * than the WebSocket rule on purpose: only followers call these, over Node's fetch, which never
 * sets Origin. Anything that does set it is a browser, and no browser has business here — including
 * one pointed at figma.com. A user opening http://127.0.0.1:3055/ping in a tab still works, because
 * top-level navigations send no Origin.
 */
export const isAllowedHttpOrigin = (origin: string | undefined): boolean => {
  if (allowAnyOrigin()) return true;
  return origin === undefined || origin === '';
};

/**
 * True when `header` names exactly `expected`, ignoring parameters (`; charset=…`) and case.
 *
 * Defence in depth behind the origin check: the CORS "simple request" forms a page can send without
 * a preflight are limited to text/plain, form-urlencoded and multipart. Demanding a media type
 * outside that set means a cross-origin POST must preflight, and the preflight fails — we answer no
 * CORS headers at all.
 */
export const hasContentType = (header: string | undefined, expected: string): boolean => {
  if (header === undefined) return false;
  const [type] = header.split(';');
  return type?.trim().toLowerCase() === expected;
};
