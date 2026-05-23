import { ErrorCode } from '@figma-mcp-relay/shared';

import type { Follower } from './election/follower.js';
import type { Node } from './election/node.js';

export const DEFAULT_DISPATCH_MAX_ATTEMPTS = 3;
export const DEFAULT_DISPATCH_RETRY_DELAY_MS = 1_500;

export interface DispatchOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  perCallTimeoutMs?: number;
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

  /* eslint-disable no-await-in-loop -- retry/backoff loop is intentionally sequential */
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (ctx.node.isLeader()) {
      const leader = ctx.node.getLeader();
      if (leader === null) {
        lastError = new DispatchError(ErrorCode.Internal, 'leader resources missing despite Leader role');
        break;
      }
      try {
        return await leader.relay.sendRequest(toolName, args, opts.perCallTimeoutMs);
      } catch (err) {
        lastError = err as Error;
        break;
      }
    }

    const resp = await ctx.follower.sendRpc(toolName, args);
    if (resp.kind === 'ok') return resp.result;

    const isTransient =
      resp.code === ErrorCode.Internal && /transport|fetch failed|ECONNREFUSED/i.test(resp.message);
    if (!isTransient || attempt === maxAttempts - 1) {
      throw new DispatchError(resp.code, resp.message);
    }

    log(`[dispatch] transient leader error, retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${maxAttempts})`);
    await new Promise<void>(resolve => setTimeout(resolve, retryDelayMs));
  }
  /* eslint-enable no-await-in-loop */

  if (lastError !== null) throw lastError;
  throw new DispatchError(ErrorCode.Internal, 'dispatch exhausted retries');
};
