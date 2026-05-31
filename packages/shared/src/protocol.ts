export const PROTOCOL_VERSION = '0.1.0';

export const DEFAULT_PORT = 3055;
export const PORT_FALLBACK_COUNT = 10;

export const portRange = (): number[] =>
  Array.from({ length: PORT_FALLBACK_COUNT }, (_, i) => DEFAULT_PORT + i);

export const ErrorCode = {
  InvalidRequest: 'INVALID_REQUEST',
  MethodNotFound: 'METHOD_NOT_FOUND',
  InvalidParams: 'INVALID_PARAMS',
  Internal: 'INTERNAL_ERROR',
  Timeout: 'TIMEOUT',
  PluginDisconnected: 'PLUGIN_DISCONNECTED',
  NotLeader: 'NOT_LEADER',
  SessionUnknown: 'SESSION_UNKNOWN',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const SystemMethod = {
  Hello: '$hello',
  Ping: '$ping',
  Echo: '$echo',
  /**
   * Plugin → leader event emitted whenever the sandbox sees user interaction (selection/page
   * change). The leader uses these to bump session priority for multi-plugin routing — heartbeats
   * and tool replies are explicitly NOT activity, only this event is.
   */
  Activity: '$activity',
} as const;
export type SystemMethod = (typeof SystemMethod)[keyof typeof SystemMethod];

declare const crypto: { randomUUID?: () => string } | undefined;
// Figma's UI iframe is a null-origin sandbox where crypto.randomUUID may be absent (non-secure
// context); fall back to a timestamp+random id so id generation never throws on the plugin side.
export const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
