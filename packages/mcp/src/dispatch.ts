import { ErrorCode, getFollowerBudget, getRelayBudget } from '@figwright/shared';

import type { Follower } from './election/follower.js';
import { type Node, NodeRole } from './election/node.js';
import type { PluginSessionInfo } from './routing/sessions.js';
import { getFileTarget, resolveFileTarget } from './routing/target.js';
import { namedSessions, type SessionDispatch } from './tools/list-files.js';
import { reportSkew } from './tools/skew-notice.js';

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

  let lastError: Error | null = null;

  // The election can declare the port wedged *while this call is in flight*, and that verdict has
  // to reach a call that is already blocked — not just the next one. Two halves: the signal cuts
  // the in-flight fetch short, and the check at the top of each attempt turns the resulting
  // transport error into the real diagnosis instead of another retry. Without the signal the first
  // call after a wedge still spent its whole budget and every retry (measured at 123s for a
  // default-budget tool) before reporting a timeout that named nothing.
  let conflicted = new AbortController();
  const stopWatching = ctx.node.onRoleChange(role => {
    if (role === NodeRole.Conflicted) conflicted.abort(new Error('port conflict'));
  });

  try {
    /* eslint-disable no-await-in-loop -- retry/backoff loop is intentionally sequential */
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      // The relay port is held by something that isn't answering as a Figwright leader, so there is
      // no leader to reach and no point forwarding to it. Fail with the diagnosis the election
      // already made (see node.conflictMessage) rather than retrying into a wall.
      if (ctx.node.isConflicted()) {
        throw new DispatchError(ErrorCode.NotLeader, ctx.node.conflictMessage);
      }

      // A fresh controller per attempt, checked *after* the line above, because an abort is spent
      // once it fires. The best outcome of a wedge is that it heals — the holder was suspended, the
      // election woke it, and by this retry there is a working leader again. Reusing the aborted
      // signal would fail that retry instantly and turn the one case that recovers on its own into
      // "This operation was aborted": strictly worse than before the abort existed. Whether the
      // conflict is over has already been decided one line up, by the role, which is the fact —
      // the signal is only how the previous attempt was interrupted.
      conflicted = new AbortController();

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
          // Attribution is captured as the request is answered, not read afterwards: two concurrent
          // calls to plugins on different builds would otherwise both see whichever finished last.
          const result = await leader.relay.sendRequest(
            toolName,
            args,
            opts.perCallTimeoutMs ?? getRelayBudget(toolName),
            opts.sessionId,
            served => reportSkew(leader.relay.skewNotice(served)),
          );
          return result;
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
        conflicted.signal,
      );
      if (resp.kind === 'ok') {
        reportSkew(resp.notice ?? null);
        return resp.result;
      }

      // 'relay stopping' is the leader rejecting the call because it's shutting down or abdicating —
      // by the retry delay a new leader (possibly this very node) has the port, so it's as transient
      // as a dropped connection. Safe to replay: writes carry a stable requestId the plugin dedupes.
      const isTransient =
        resp.code === ErrorCode.Internal &&
        /transport|fetch failed|ECONNREFUSED|relay stopping/i.test(resp.message);
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
  } finally {
    stopWatching();
  }
};

/**
 * The plugin sessions currently connected, whichever role this process holds. Leader reads its own
 * relay; follower asks the leader over /ping. A conflicted node has no leader to ask.
 */
export const listPluginSessions = async (
  ctx: DispatchContext,
): Promise<readonly PluginSessionInfo[]> => {
  if (ctx.node.isConflicted()) return [];
  if (ctx.node.isLeader()) return ctx.node.getLeader()?.relay.listSessionInfo() ?? [];
  return ctx.follower.listSessions();
};

/**
 * Resolve the plugin session routing would currently pick, so a multi-call tool can pin every
 * sub-call to one plugin (see DispatchOptions.sessionId). Leader resolves locally; follower asks
 * the leader over /ping. Returns undefined when no plugin is connected or the leader is unreachable
 * — in that case sub-calls run unpinned, i.e. the pre-existing most-active routing on each call.
 *
 * A bound file target outranks live routing: a multi-call tool run by an agent that has claimed a
 * file must stay in that file even for its first sub-call.
 */
export const resolveRoutingSession = async (ctx: DispatchContext): Promise<string | undefined> => {
  // A conflicted node has no leader to ask (the port holder isn't answering as one) — resolve to
  // undefined so sub-calls run unpinned, and don't waste an HTTP round-trip on it.
  if (ctx.node.isConflicted()) return undefined;
  if (getFileTarget() !== null) return resolveTargetFor(ctx);
  if (ctx.node.isLeader()) {
    return ctx.node.getLeader()?.relay.pickActiveSessionId();
  }
  return ctx.follower.resolveActiveSession();
};

/**
 * The relay's answer when a pinned session is not there any more. Matched on rather than typed
 * because it crosses /rpc as a string: the leader maps it to PLUGIN_DISCONNECTED and the message
 * travels with it (see leader-endpoints' error mapping).
 */
const isPinnedSessionGone = (err: unknown): boolean =>
  err instanceof Error && err.message.includes('pinned session not connected');

/** Dispatch `list_files` to one named session — the probing source's transport. */
const sessionDispatch =
  (ctx: DispatchContext): SessionDispatch =>
  (sessionId, toolName, args, perCallTimeoutMs) =>
    dispatchTool(ctx, toolName, args, { sessionId, perCallTimeoutMs });

/**
 * Resolve this process's claimed session, asking the plugins for their file names only if the cheap
 * check fails (see routing/target.ts's SessionSource).
 */
const resolveTargetFor = async (ctx: DispatchContext): Promise<string | undefined> =>
  resolveFileTarget(
    () => listPluginSessions(ctx),
    async () => namedSessions(await listPluginSessions(ctx), sessionDispatch(ctx)),
  );

/**
 * Dispatch honouring this process's bound file target (routing/target.ts).
 *
 * Unbound, this is `dispatchTool` unchanged — no extra round-trip, no behaviour change, which is
 * what keeps single-agent follow-the-foreground exactly as it was.
 *
 * Bound, the target's session id goes on the call directly instead of being re-validated first.
 * Checking liveness up front would cost every single call an extra `/ping` on the follower path to
 * defend against a state that is rare (the user closed and reopened the panel) and that the relay
 * already detects for free. So the check happens where the evidence appears: the relay refuses an
 * absent pinned session, and only then does this ask what is connected and try to recover the
 * binding by file name. One retry, because recovery either produced a live session or threw.
 */
export const dispatchTargeted = async (
  ctx: DispatchContext,
  toolName: string,
  args: unknown,
  opts: DispatchOptions = {},
): Promise<unknown> => {
  const target = getFileTarget();
  if (target === null) return dispatchTool(ctx, toolName, args, opts);

  try {
    return await dispatchTool(ctx, toolName, args, { ...opts, sessionId: target.sessionId });
  } catch (err) {
    if (!isPinnedSessionGone(err)) throw err;
    // Throws (with the file named, and what is connected instead) when the binding cannot be
    // recovered — deliberately, because the fallback would be another file's nodes. It can only
    // answer undefined for an unbound process, which this one is not.
    const recovered = await resolveTargetFor(ctx);
    if (recovered === undefined) throw err;
    return dispatchTool(ctx, toolName, args, { ...opts, sessionId: recovered });
  }
};
