export const PROTOCOL_VERSION = '0.1.0';

// The relay leader always binds this one fixed port. The election never hops to a fallback: a node
// that can't bind it becomes a follower (which listens on nothing), so the plugin only ever needs to
// reach DEFAULT_PORT. There is deliberately no port range to scan.
export const DEFAULT_PORT = 3055;

export const ErrorCode = {
  InvalidRequest: 'INVALID_REQUEST',
  MethodNotFound: 'METHOD_NOT_FOUND',
  InvalidParams: 'INVALID_PARAMS',
  Internal: 'INTERNAL_ERROR',
  Timeout: 'TIMEOUT',
  PluginDisconnected: 'PLUGIN_DISCONNECTED',
  NotLeader: 'NOT_LEADER',
  SessionUnknown: 'SESSION_UNKNOWN',
  ProtocolMismatch: 'PROTOCOL_MISMATCH',
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

declare const crypto:
  | { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => Uint8Array }
  | undefined;

/** 16 bytes from the platform CSPRNG as hex, or null where there is none. */
const randomHex128 = (): string | null => {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') return null;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
};

/**
 * A fresh id. The plugin's session id is one, and resuming a session needs only that id, so it must
 * be unguessable, not merely unique.
 *
 * Figma's plugin UI is a `data:` document — not a secure context — so `crypto.randomUUID` is absent
 * there (measured in the desktop app), while `crypto.getRandomValues`, which needs no secure
 * context, is present: that is where the 128-bit branch is taken. The timestamp+Math.random form
 * (~41 bits, from a non-cryptographic generator) remains only so id generation can never throw in
 * an environment with neither.
 */
export const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = randomHex128();
  if (hex !== null) return `id-${hex}`;
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
