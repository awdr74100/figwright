/**
 * The relay's public shape: what a connection _is_ to the rest of the panel, separate from how it
 * is established.
 *
 * Everything the UI renders comes from here — so components depend on this model rather than on
 * `client.ts`, which owns sockets, back-off and heartbeats and is of no concern to a view. The
 * activity transitions are pure functions over that model for the same reason: how a call is
 * recorded, capped and de-duplicated is testable on its own, without a socket in sight.
 */

import type { ActivityPayload } from './payload.js';

export type RelayStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type ToolHandler = (method: string, params: unknown) => Promise<unknown>;

/** Most-recent tool calls kept in memory for the UI Activity tab. */
export const ACTIVITY_LIMIT = 30;

export type ActivityStatus = 'pending' | 'ok' | 'error';

export interface ActivityEntry {
  /** Request id of the originating tool call. */
  id: string;
  method: string;
  startedAt: number;
  status: ActivityStatus;
  durationMs?: number;
  error?: string;
  /** Snapshot of the call's request params (see payload.ts) — what we were asked to do. */
  request?: ActivityPayload;
  /** For a successful call, a snapshot of the result sent back to the LLM (see payload.ts). */
  payload?: ActivityPayload;
  /**
   * Nodes this call touched (see node-ids.ts) — collected from the params it was given and the
   * result it produced, so the panel can offer to reveal them on canvas. Absent when the call
   * referenced none.
   */
  nodeIds?: readonly string[];
}

export interface RelayClientState {
  status: RelayStatus;
  port: number | null;
  sessionResumed: boolean;
  /** Server version from the hello handshake, or null until connected (for diagnostics). */
  serverVersion: string | null;
  lastError: string | null;
  /** Epoch ms of the current connection, or null while not connected (for uptime). */
  connectedAt: number | null;
  /** How many times the live socket dropped and was re-established. */
  reconnectCount: number;
  /** Total tool calls received this session (not capped by ACTIVITY_LIMIT). */
  totalCalls: number;
  /**
   * How many of those calls failed. Counted alongside `totalCalls` rather than derived from
   * `activity`, so the two stay comparable once the recent list is capped.
   */
  failedCalls: number;
  /** Recent tool calls, most-recent-first, capped at ACTIVITY_LIMIT. */
  activity: readonly ActivityEntry[];
}

/** A connection that has not been attempted yet. */
export const initialRelayState = (): RelayClientState => ({
  status: 'idle',
  port: null,
  sessionResumed: false,
  serverVersion: null,
  lastError: null,
  connectedAt: null,
  reconnectCount: 0,
  totalCalls: 0,
  failedCalls: 0,
  activity: [],
});

export interface CallStart {
  id: string;
  method: string;
  startedAt: number;
  request?: ActivityPayload;
  nodeIds?: readonly string[];
}

export interface CallEnd {
  id: string;
  status: ActivityStatus;
  settledAt: number;
  error?: string;
  payload?: ActivityPayload;
  /** Ids the _result_ named, folded in on top of those the params already carried. */
  nodeIds?: readonly string[];
}

/**
 * Record a call that just started: it goes to the front of the recent list, the oldest falls off
 * the end, and the lifetime total goes up. The total is counted here rather than derived from the
 * list so it stays honest once the list has rolled over.
 */
export const recordCallStart = (
  state: RelayClientState,
  call: CallStart,
): Partial<RelayClientState> => {
  const entry: ActivityEntry = {
    id: call.id,
    method: call.method,
    startedAt: call.startedAt,
    status: 'pending',
    ...(call.request === undefined ? {} : { request: call.request }),
    ...(call.nodeIds === undefined || call.nodeIds.length === 0 ? {} : { nodeIds: call.nodeIds }),
  };
  return {
    totalCalls: state.totalCalls + 1,
    activity: [entry, ...state.activity].slice(0, ACTIVITY_LIMIT),
  };
};

/**
 * Settle a recorded call with its outcome. A call whose entry has already been dropped from the
 * capped list settles into nothing — the failure counter still moves, because that count is about
 * the session rather than about what's still on screen.
 */
export const recordCallEnd = (
  state: RelayClientState,
  call: CallEnd,
): Partial<RelayClientState> => ({
  ...(call.status === 'error' ? { failedCalls: state.failedCalls + 1 } : {}),
  activity: state.activity.map(entry => {
    if (entry.id !== call.id) return entry;
    // Params first, then anything new the result named — de-duped, so a call that both targets and
    // returns the same node lists it once.
    const nodeIds = [...new Set([...(entry.nodeIds ?? []), ...(call.nodeIds ?? [])])];
    return {
      ...entry,
      status: call.status,
      durationMs: call.settledAt - entry.startedAt,
      ...(call.error === undefined ? {} : { error: call.error }),
      ...(call.payload === undefined ? {} : { payload: call.payload }),
      ...(nodeIds.length === 0 ? {} : { nodeIds }),
    };
  }),
});
