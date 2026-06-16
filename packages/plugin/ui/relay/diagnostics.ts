// Builds a one-shot diagnostic bundle a user can copy into a bug report so the issue can be
// reproduced: versions + the connected context + the ordered sequence of tool calls, each with its
// request params and the result (or error) it produced. Pure + testable; the UI just feeds it state.
//
// Payloads are the same elided/capped snapshots the Activity inspector shows (base64 images are
// elided, huge trees capped). The bundle therefore contains the user's design content + file/page
// names — the caller surfaces that before copying.

import type { PluginContextEvent } from '@figwright/shared';

import type { RelayClientState } from './client.js';
import type { ActivityPayload } from './payload.js';

export const DIAGNOSTIC_SCHEMA = 'figwright-diagnostic@1';

export interface DiagnosticMeta {
  pluginVersion: string;
  protocolVersion: string;
  sessionId: string;
  userAgent?: string;
  /** Override "now" for deterministic tests. */
  now?: number;
}

// A non-truncated snapshot is valid JSON (elision markers are just string values), so parse it back
// to nest cleanly in the bundle; a truncated one isn't, so keep it as a flagged string.
const decodePayload = (p: ActivityPayload): unknown => {
  if (p.truncated) return { truncated: true, preview: p.preview };
  try {
    return JSON.parse(p.preview);
  } catch {
    return p.preview;
  }
};

/** Serialize the current client state + context into a diagnostic bundle JSON string. */
export const buildDiagnosticBundle = (
  state: RelayClientState,
  context: PluginContextEvent | null,
  meta: DiagnosticMeta,
): string => {
  const bundle = {
    schema: DIAGNOSTIC_SCHEMA,
    exportedAt: new Date(meta.now ?? Date.now()).toISOString(),
    versions: {
      plugin: meta.pluginVersion,
      protocol: meta.protocolVersion,
      server: state.serverVersion,
      editorType: context?.editorType ?? null,
      apiVersion: context?.apiVersion ?? null,
      ...(meta.userAgent === undefined ? {} : { userAgent: meta.userAgent }),
    },
    context:
      context === null
        ? null
        : {
            fileName: context.fileName,
            pageName: context.pageName,
            selectionCount: context.selectionCount,
            selection: context.selection,
          },
    session: {
      id: meta.sessionId,
      reconnectCount: state.reconnectCount,
      totalCalls: state.totalCalls,
    },
    // Activity is most-recent-first; reverse so the bundle reads as the sequence that happened.
    calls: state.activity.toReversed().map(e => {
      const call: Record<string, unknown> = {
        method: e.method,
        status: e.status,
        startedAt: new Date(e.startedAt).toISOString(),
      };
      if (e.durationMs !== undefined) call.durationMs = e.durationMs;
      if (e.request !== undefined) call.request = decodePayload(e.request);
      if (e.payload !== undefined) call.result = decodePayload(e.payload);
      if (e.error !== undefined) call.error = e.error;
      return call;
    }),
  };
  return JSON.stringify(bundle, null, 2);
};
