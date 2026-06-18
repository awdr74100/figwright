import {
  createToolCall,
  getToolBudget,
  isPluginBridgeMessage,
  newId,
  type PluginBridgeMessage,
} from '@figwright/shared';

import type { ToolHandler } from '../relay/client.js';

export type PostMessageFn = (msg: PluginBridgeMessage) => void;
export type SubscribeFn = (cb: (raw: unknown) => void) => () => void;

export interface SandboxBridgeOptions {
  timeoutMs?: number;
  log?: (msg: string) => void;
  postMessage?: PostMessageFn;
  subscribe?: SubscribeFn;
}

export interface SandboxBridge {
  handler: ToolHandler;
  pendingCount: () => number;
  dispose: () => void;
}

const defaultPostMessage: PostMessageFn = msg => {
  (globalThis as { parent?: { postMessage: (m: unknown, t: string) => void } }).parent?.postMessage(
    { pluginMessage: msg },
    '*',
  );
};

const defaultSubscribe: SubscribeFn = cb => {
  const target = globalThis as {
    addEventListener?: (ev: string, fn: (e: MessageEvent) => void) => void;
    removeEventListener?: (ev: string, fn: (e: MessageEvent) => void) => void;
  };
  const listener = (event: MessageEvent): void => {
    const data = event.data as { pluginMessage?: unknown } | null;
    if (data === null || typeof data !== 'object') return;
    if ('pluginMessage' in data) cb(data.pluginMessage);
  };
  target.addEventListener?.('message', listener);
  return () => target.removeEventListener?.('message', listener);
};

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

export const createSandboxBridge = (opts: SandboxBridgeOptions = {}): SandboxBridge => {
  const log = opts.log ?? ((): void => {});
  const post = opts.postMessage ?? defaultPostMessage;
  const subscribe = opts.subscribe ?? defaultSubscribe;

  const pending = new Map<string, Pending>();

  const unsubscribe = subscribe(raw => {
    if (!isPluginBridgeMessage(raw)) return;
    if (raw.kind === 'tool-call') return;
    const entry = pending.get(raw.id);
    if (entry === undefined) {
      log(`[sandbox-bridge] orphan ${raw.kind} for id=${raw.id}`);
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
      entry.reject(new Error('sandbox bridge disposed'));
    }
    pending.clear();
  };

  return {
    handler,
    pendingCount: () => pending.size,
    dispose,
  };
};
