/**
 * Tool RPC across the iframe boundary: the relay hands a tool call to `handler`, this turns it into
 * a bridge message the sandbox can execute, and resolves once the matching reply comes back.
 */

import { ErrorCode, getToolBudget, newId } from '@figwright/shared';

import {
  createToolCall,
  isPluginBridgeMessage,
  type PluginBridgeMessage,
  PluginToolFailure,
} from '../../protocol/bridge.js';
import type { ToolHandler } from '../relay/state.js';
import { onSandboxMessage, postToSandbox } from './messaging.js';

/**
 * Tools whose Figma work is library resolution, which Figma may defer in a background file. A
 * timeout for one says how to recover; it does not cancel the import, which may still complete
 * afterwards.
 */
const LIBRARY_IMPORT_TOOLS: ReadonlySet<string> = new Set(['import_variable', 'import_style']);

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
      entry.reject(new PluginToolFailure(raw.code, raw.message));
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
        const message = `sandbox tool timeout (method=${method})`;
        if (LIBRARY_IMPORT_TOOLS.has(method)) {
          reject(
            new PluginToolFailure(
              ErrorCode.Timeout,
              `${message}. Figma may defer library resolution in a background file. ` +
                'Bring the target Figma file to the foreground and retry. ' +
                'The import may still complete after this timeout.',
            ),
          );
        } else {
          reject(new Error(message));
        }
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
