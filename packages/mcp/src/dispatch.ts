import { ErrorCode, getFollowerBudget, getRelayBudget } from '@figwright/shared';

import type { Follower } from './election/follower.js';
import type { Node } from './election/node.js';

export const DEFAULT_DISPATCH_MAX_ATTEMPTS = 3;
export const DEFAULT_DISPATCH_RETRY_DELAY_MS = 1_500;

export interface DispatchOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  perCallTimeoutMs?: number;
  // Pin this call to a specific plugin session (resolved once via resolveRoutingSession) so a
  // multi-call tool's sub-calls can't drift across plugins if routing flips mid-flight.
  sessionId?: string;
}

export interface DispatchContext {
  node: Node;
  follower: Follower;
  log?: (msg: string) => void;
}

export class DispatchError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DispatchError';
  }
}

export const dispatchTool = async (
  ctx: DispatchContext,
  toolName: string,
  args: unknown,
  opts: DispatchOptions = {},
): Promise<unknown> => {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_DISPATCH_MAX_ATTEMPTS;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_DISPATCH_RETRY_DELAY_MS;
  const log = ctx.log ?? ((): void => {});

  // The relay port is held by a non-Figwright process, so there's no leader to reach and no point
  // forwarding to the squatter. Fail fast with an actionable message rather than retrying into a wall.
  if (ctx.node.isConflicted()) {
    throw new DispatchError(
      ErrorCode.NotLeader,
      `port ${ctx.node.port} is held by a non-Figwright process, so Figwright can't run tools against ` +
        `your plugin. Free that port (e.g. lsof -iTCP:${ctx.node.port} -sTCP:LISTEN) and Figwright ` +
        `reconnects automatically.`,
    );
  }

  let lastError: Error | null = null;

  /* eslint-disable no-await-in-loop -- retry/backoff loop is intentionally sequential */
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (ctx.node.isLeader()) {
      const leader = ctx.node.getLeader();
      if (leader === null) {
        lastError = new DispatchError(
          ErrorCode.Internal,
          'leader resources missing despite Leader role',
        );
        break;
      }
      try {
        // Relay→plugin budget = B + one margin (see getRelayBudget) so the inner sandbox-bridge timer
        // fires first. opts.perCallTimeoutMs overrides for callers/tests that need a specific value.
        return await leader.relay.sendRequest(
          toolName,
          args,
          opts.perCallTimeoutMs ?? getRelayBudget(toolName),
          opts.sessionId,
        );
      } catch (err) {
        lastError = err as Error;
        break;
      }
    }

    // Follower→leader budget = B + two margins (outermost layer), so it outlives the leader's own
    // relay timer for the same tool.
    const resp = await ctx.follower.sendRpc(
      toolName,
      args,
      undefined,
      opts.sessionId,
      opts.perCallTimeoutMs ?? getFollowerBudget(toolName),
    );
    if (resp.kind === 'ok') return resp.result;

    const isTransient =
      resp.code === ErrorCode.Internal && /transport|fetch failed|ECONNREFUSED/i.test(resp.message);
    if (!isTransient || attempt === maxAttempts - 1) {
      throw new DispatchError(resp.code, resp.message);
    }

    log(
      `[dispatch] transient leader error, retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${maxAttempts})`,
    );
    await new Promise<void>(resolve => setTimeout(resolve, retryDelayMs));
  }
  /* eslint-enable no-await-in-loop */

  if (lastError !== null) throw lastError;
  throw new DispatchError(ErrorCode.Internal, 'dispatch exhausted retries');
};

/**
 * Resolve the plugin session routing would currently pick, so a multi-call tool can pin every
 * sub-call to one plugin (see DispatchOptions.sessionId). Leader resolves locally; follower asks
 * the leader over /ping. Returns undefined when no plugin is connected or the leader is unreachable
 * — in that case sub-calls run unpinned, i.e. the pre-existing most-active routing on each call.
 */
export const resolveRoutingSession = async (ctx: DispatchContext): Promise<string | undefined> => {
  // A conflicted node has no leader to ask (the port holder isn't Figwright) — resolve to undefined so
  // sub-calls run unpinned, and don't waste an HTTP round-trip on the squatter.
  if (ctx.node.isConflicted()) return undefined;
  if (ctx.node.isLeader()) {
    return ctx.node.getLeader()?.relay.pickActiveSessionId();
  }
  return ctx.follower.resolveActiveSession();
};
