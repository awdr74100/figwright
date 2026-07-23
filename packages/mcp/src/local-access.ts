/**
 * Who may talk to the leader's loopback endpoints.
 *
 * Binding to 127.0.0.1 keeps the LAN out; it does not keep the user's own browser out. Two distinct
 * paths lead from a web page to a local port, and they need two distinct checks:
 *
 * - **Cross-site.** A page can open a WebSocket to a local port (WebSockets have no same-origin
 *   policy) or POST a CORS "simple request" to one. It can't read the reply, but the side effect
 *   already happened. Such a request carries an `Origin` the page cannot forge → gated by origin.
 * - **DNS rebinding.** A page on attacker.com whose DNS re-resolves to 127.0.0.1 reaches us as
 *   _same-origin_, so a GET carries no `Origin` at all and the reply IS readable. What it cannot
 *   change is `Host`, which still names the attacker's domain → gated by host.
 *
 * The MCP security best practices ("Local MCP Server Compromise") name DNS rebinding explicitly;
 * the host gate follows the shape Playwright uses for its own local servers.
 */

/**
 * Figma renders plugin UI in a sandboxed iframe, whose serialized origin is the literal string
 * "null". The www/apex pair is belt-and-braces for a host that ever sends a real origin instead.
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

/** True when a WebSocket upgrade carrying this `Origin` may become a plugin session. */
export const isAllowedWsOrigin = (origin: string | undefined): boolean => {
  if (allowAnyOrigin()) return true;
  // Absent header: a non-browser client (the desktop app's plugin host, a test harness). Browsers
  // always set Origin on a WebSocket handshake, so this can't be a web page.
  if (origin === undefined || origin === '') return true;
  return PLUGIN_ORIGINS.has(origin);
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
