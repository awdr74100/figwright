/**
 * Tool RPC across the iframe boundary: the relay hands a tool call to `handler`, this turns it into
 * a bridge message the sandbox can execute, and resolves once the matching reply comes back.
 */

import {
  createToolCall,
  getToolBudget,
  isPluginBridgeMessage,
  newId,
  type PluginBridgeMessage,
} from '@figwright/shared';

import type { ToolHandler } from '../relay/state.js';
import { onSandboxMessage, postToSandbox } from './messaging.js';

export type PostMessageFn = (msg: PluginBridgeMessage) => void;
export type SubscribeFn = (cb: (raw: unknown) => void) => () => void;

export interface ToolBridgeOptions {
  timeoutMs?: number;
  log?: (msg: string) => void;
  postMessage?: PostMessageFn;
  subscribe?: SubscribeFn;
}

export interface ToolBridge {
  handler: ToolHandler;
  pendingCount: () => number;
  dispose: () => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

export const createToolBridge = (opts: ToolBridgeOptions = {}): ToolBridge => {
  const log = opts.log ?? ((): void => {});
  const post = opts.postMessage ?? postToSandbox;
  const subscribe = opts.subscribe ?? onSandboxMessage;

  const pending = new Map<string, Pending>();

  const unsubscribe = subscribe(raw => {
    if (!isPluginBridgeMessage(raw)) return;
    if (raw.kind === 'tool-call') return;
    const entry = pending.get(raw.id);
    if (entry === undefined) {
      log(`[tool-bridge] orphan ${raw.kind} for id=${raw.id}`);
      return;
    }
    clearTimeout(entry.timer);
    pending.delete(raw.id);
    if (raw.kind === 'tool-result') {
      entry.resolve(raw.result);
    } else {
      entry.reject(new Error(`${raw.code}: ${raw.message}`));
    }
  });

  const handler: ToolHandler = (method, params) =>
    new Promise<unknown>((resolve, reject) => {
      const id = newId();
      // Per-tool budget (innermost layer B) so a heavy tool isn't capped at the default window while
      // the relay still waits. An explicit opts.timeoutMs overrides for tests. See getToolBudget.
      const timeoutMs = opts.timeoutMs ?? getToolBudget(method);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`sandbox tool timeout (method=${method})`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      post(createToolCall({ id, method, params }));
    });

  const dispose = (): void => {
    unsubscribe();
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('tool bridge disposed'));
    }
    pending.clear();
  };

  return {
    handler,
    pendingCount: () => pending.size,
    dispose,
  };
};
