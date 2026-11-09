import type { WsUpgradeVerdict } from '../local-access.js';

/** Why the relay turned a WebSocket upgrade away. */
export type RefusalReason = 'host' | Exclude<WsUpgradeVerdict, 'admit'>;

/**
 * Upgrades the relay has refused since this leader started, by reason, with the most recent one.
 *
 * Kept because a refusal is silent from the plugin's side: a Figma build whose User-Agent this
 * server did not anticipate would just never connect, and every tool would time out with nothing
 * saying why. Counting them makes that case visible to the agent (ping, and the timeout of a call
 * no plugin ever received) instead of only to whoever reads the server's stderr.
 */
export interface RefusedUpgrades {
  host: number;
  origin: number;
  userAgent: number;
  last: {
    reason: RefusalReason;
    /** Epoch ms. */
    at: number;
    origin: string | null;
    /** Capped: the header is untrusted, and only its shape matters for a diagnosis. */
    userAgent: string | null;
  } | null;
}

const MAX_HEADER_ECHO = 200;

const capped = (value: string | undefined): string | null =>
  value === undefined ? null : value.slice(0, MAX_HEADER_ECHO);

export class RefusedUpgradeLog {
  private readonly counts = { host: 0, origin: 0, userAgent: 0 };
  private last: RefusedUpgrades['last'] = null;

  record(reason: RefusalReason, origin: string | undefined, userAgent: string | undefined): void {
    if (reason === 'host') this.counts.host += 1;
    else if (reason === 'origin') this.counts.origin += 1;
    else this.counts.userAgent += 1;
    this.last = { reason, at: Date.now(), origin: capped(origin), userAgent: capped(userAgent) };
  }

  /** A copy, or null when nothing has been refused — so a clean ping carries nothing new. */
  snapshot(): RefusedUpgrades | null {
    if (this.last === null) return null;
    return { ...this.counts, last: { ...this.last } };
  }
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';
const REASONS: ReadonlySet<unknown> = new Set<RefusalReason>(['host', 'origin', 'user-agent']);

/**
 * A follower's read of the leader's `refusedConnections` (/ping). Undefined for anything not in the
 * shape a leader writes — absent on a leader that predates it, or malformed — so a bad field can
 * never make a follower doubt an otherwise healthy leader.
 */
export const parseRefusedUpgrades = (value: unknown): RefusedUpgrades | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const r = value as Record<string, unknown>;
  if (!isCount(r.host) || !isCount(r.origin) || !isCount(r.userAgent)) return undefined;
  let last: RefusedUpgrades['last'] = null;
  if (r.last !== null) {
    if (typeof r.last !== 'object' || r.last === undefined) return undefined;
    const l = r.last as Record<string, unknown>;
    if (!REASONS.has(l.reason) || typeof l.at !== 'number') return undefined;
    if (!isNullableString(l.origin) || !isNullableString(l.userAgent)) return undefined;
    last = {
      reason: l.reason as RefusalReason,
      at: l.at,
      origin: l.origin === null ? null : l.origin.slice(0, MAX_HEADER_ECHO),
      userAgent: l.userAgent === null ? null : l.userAgent.slice(0, MAX_HEADER_ECHO),
    };
  }
  return { host: r.host, origin: r.origin, userAgent: r.userAgent, last };
};

/**
 * The guidance for refusals that could be a real plugin: an upgrade from the plugin's origin
 * without the Figma desktop app's User-Agent. Null when there were none. Shared by the log line,
 * ping and the timeout of a call no plugin received, so the three cannot drift apart.
 */
export const userAgentRefusalNotice = (refused: RefusedUpgrades | null): string | null => {
  if (refused === null || refused.userAgent === 0) return null;
  const last =
    refused.last?.reason === 'user-agent'
      ? ` (most recent at ${new Date(refused.last.at).toISOString()}, User-Agent ${JSON.stringify(
          refused.last.userAgent ?? '(none)',
        )})`
      : '';
  return (
    `${refused.userAgent} plugin connection(s) were refused because they did not come from the ` +
    `Figma desktop app${last}. The Figwright plugin runs only in that app, so a browser tab is ` +
    'refused by design and needs nothing done. If the Figma desktop app is open and its plugin ' +
    'cannot connect, a Figma update may have changed its User-Agent: set ' +
    'FIGWRIGHT_ALLOW_ANY_ORIGIN=1 in the environment of every Figwright MCP server and restart ' +
    'them — the one holding port 3055 is the one that checks — to connect anyway (it lifts this ' +
    'check, and ping reports while it is set, so remove it once fixed), and report the ' +
    'User-Agent above at https://github.com/awdr74100/figwright/issues.'
  );
};
