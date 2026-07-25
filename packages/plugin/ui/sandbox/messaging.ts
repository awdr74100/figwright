/**
 * The wire between this iframe and the Figma sandbox, at its lowest level: every message either
 * side sends is wrapped in a `{ pluginMessage }` envelope, and this is the one module that knows
 * that.
 *
 * Two kinds of traffic share it — tool RPC (`@figwright/shared`) and panel control
 * (`protocol/panel-control.ts`) — so `postToSandbox` is typed as their union: a message that
 * belongs to neither channel can't be sent by accident, which is the guarantee the old
 * `unknown`-typed post lacked.
 */

import {
  isPluginContextEvent,
  type PluginBridgeMessage,
  type PluginContextEvent,
} from '@figwright/shared';

import type { PanelControlMessage } from '../../protocol/panel-control.js';

/** Everything the panel is allowed to send up to the sandbox. */
export type SandboxOutbound = PluginBridgeMessage | PanelControlMessage;

type ParentFrame = { postMessage: (message: unknown, targetOrigin: string) => void };

type MessageTarget = {
  addEventListener?: (type: string, fn: (event: MessageEvent) => void) => void;
  removeEventListener?: (type: string, fn: (event: MessageEvent) => void) => void;
};

/**
 * Post up to the sandbox. No-op when there is no parent frame — the panel also renders in contexts
 * without one (tests, a plain browser tab), and a missing parent must not take the whole UI down.
 */
export const postToSandbox = (message: SandboxOutbound): void => {
  (globalThis as { parent?: ParentFrame }).parent?.postMessage({ pluginMessage: message }, '*');
};

/**
 * Subscribe to raw inbound messages, unwrapped from their envelope. Returns an unsubscribe.
 *
 * Deliberately untyped at this layer: the two channels validate their own traffic (`isPluginBridge
 * Message`, `parsePanelControl`), and a listener that only cares about one of them has to be able
 * to ignore the other's messages rather than reject them.
 */
export const onSandboxMessage = (listener: (message: unknown) => void): (() => void) => {
  const target = globalThis as MessageTarget;
  const onMessage = (event: MessageEvent): void => {
    const data = event.data as { pluginMessage?: unknown } | null;
    if (data === null || typeof data !== 'object') return;
    if ('pluginMessage' in data) listener(data.pluginMessage);
  };
  target.addEventListener?.('message', onMessage);
  return () => target.removeEventListener?.('message', onMessage);
};

/**
 * Subscribe to the context pushes the sandbox emits on open, page change and selection change.
 *
 * A separate subscription from the tool bridge's rather than one shared demultiplexer, because the
 * two have different lifetimes: the bridge's ends when the bridge is disposed, this one when the
 * panel's reactive scope is. They filter on disjoint message shapes, so both seeing every message
 * costs one failed tag compare each.
 */
export const onSandboxContext = (listener: (event: PluginContextEvent) => void): (() => void) =>
  onSandboxMessage(message => {
    if (isPluginContextEvent(message)) listener(message);
  });
