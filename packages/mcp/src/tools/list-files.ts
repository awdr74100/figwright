import type { ListFilesResult } from '@figwright/shared';
import { z } from 'zod';

import type { PluginSessionInfo } from '../routing/sessions.js';
import { getFileTarget } from '../routing/target.js';
import type { ToolSpec } from './spec.js';

export const LIST_FILES_TOOL_NAME = 'list_files';

export const listFilesTool: ToolSpec = {
  name: LIST_FILES_TOOL_NAME,
  description:
    'Return every Figma file that currently has the Figwright plugin open, as { files: [{ sessionId, ' +
    'fileName, currentPage, pluginVersion, routed, bound, duplicateName?, error? }] }. More than one ' +
    'entry means more than one file is reachable, and calls follow whichever one the user last ' +
    'touched (routed: true) — which changes under you when they switch tabs. Claim one with ' +
    'use_file so this agent stays in it. bound marks the file this agent has claimed. ' +
    'duplicateName marks entries sharing a name (Figma allows it; "x (Copy)" is the usual way), ' +
    'for which use_file needs the sessionId rather than the name. fileKey is always null: only ' +
    'private-org plugins can read it.',
  inputSchema: z.object({}),
  // Still a read on the wire, under its own name: the server dispatches `list_files` to each
  // connected session and the plugin's handler is unchanged. Only the aggregation across sessions
  // is new, and that part is the server's own knowledge.
  kind: 'read',
};

/**
 * One connected file. Richer than the plugin's own `list_files` reply because the interesting facts
 * here are the ones only the server knows: which session served it, which one calls currently go
 * to, and which one this agent has claimed.
 */
export interface ConnectedFile {
  sessionId: string;
  fileKey: string | null;
  fileName: string | null;
  currentPage: { id: string; name: string } | null;
  pluginVersion: string;
  /** Where an unbound call would go right now — the file the user last interacted with. */
  routed: boolean;
  /** The file this server process has claimed via use_file. */
  bound: boolean;
  /** Another connected file answers to the same name, so use_file must be given the sessionId. */
  duplicateName?: boolean;
  /** This session did not answer; the entry is what the server knew about it. */
  error?: string;
}

/** One session after asking its plugin what file it is in. */
export interface ProbedSession {
  /** The session with `fileName` / `pageName` replaced by the plugin's own answer when it gave one. */
  session: PluginSessionInfo;
  fileKey: string | null;
  currentPage: { id: string; name: string } | null;
  error?: string;
}

/**
 * A plugin that cannot answer this shouldn't take the whole listing down with it. The call is
 * trivial (three fields off `figma.root`), so anything slower than this is a plugin in trouble, and
 * the entry is still useful without its reply — the server already knows the session's id and its
 * last reported file name.
 */
export const LIST_FILES_PER_SESSION_TIMEOUT_MS = 5_000;

/**
 * Dispatch to one named session. Takes the tool and its arguments rather than baking them in, so
 * the payload that reaches a plugin is built here, in the code the wire-schema gate inspects — a
 * dispatcher that only took a session id would move that payload into its callers and out of the
 * gate's reach.
 */
export type SessionDispatch = (
  sessionId: string,
  toolName: string,
  args: unknown,
  perCallTimeoutMs: number,
) => Promise<unknown>;

/**
 * Ask every connected plugin what file it is in, in parallel.
 *
 * Asking each one rather than reading the server's own `$activity` cache is what makes this
 * authoritative, and the cache is wrong far more often than it looks. `$activity` is gated on tab
 * visibility so that a background file can never steal routing — which means a session reports its
 * file only once its own tab is in front _and_ the user does something in it. A session that just
 * connected has therefore reported nothing at all, and reconnection is not an edge case: every
 * leader handover and every server restart puts every plugin through it. Reading the cache in that
 * window sees a set of nameless sessions, which is exactly when an agent is trying to find its
 * file.
 *
 * The plugin, asked directly, always knows.
 */
export const probeSessions = async (
  sessions: readonly PluginSessionInfo[],
  dispatch: SessionDispatch,
): Promise<readonly ProbedSession[]> =>
  Promise.all(
    sessions.map(async (session): Promise<ProbedSession> => {
      try {
        const reply = (await dispatch(
          session.id,
          LIST_FILES_TOOL_NAME,
          {},
          LIST_FILES_PER_SESSION_TIMEOUT_MS,
        )) as ListFilesResult;
        const file = reply.files[0];
        if (file === undefined) throw new Error('plugin returned no file');
        return {
          session: { ...session, fileName: file.fileName, pageName: file.currentPage.name },
          fileKey: file.fileKey,
          currentPage: file.currentPage,
        };
      } catch (err) {
        // Keep whatever the relay last heard rather than dropping the session: a plugin that can't
        // answer is still connected, and hiding it would read as "that file isn't open".
        return {
          session,
          fileKey: null,
          currentPage: session.pageName === null ? null : { id: '', name: session.pageName },
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

/** The sessions as file targeting should see them: names filled in from the plugins themselves. */
export const namedSessions = async (
  sessions: readonly PluginSessionInfo[],
  dispatch: SessionDispatch,
): Promise<readonly PluginSessionInfo[]> =>
  (await probeSessions(sessions, dispatch)).map(p => p.session);

export const handleListFiles = async (
  sessions: readonly PluginSessionInfo[],
  dispatch: SessionDispatch,
): Promise<{ files: ConnectedFile[] }> => {
  const target = getFileTarget();
  // Sessions arrive newest-activity-first, so the first is the one live routing would pick.
  const routedId = sessions[0]?.id;

  const files: ConnectedFile[] = (await probeSessions(sessions, dispatch)).map(probed => {
    const file: ConnectedFile = {
      sessionId: probed.session.id,
      pluginVersion: probed.session.pluginVersion,
      routed: probed.session.id === routedId,
      bound: probed.session.id === target?.sessionId,
      fileKey: probed.fileKey,
      fileName: probed.session.fileName,
      currentPage: probed.currentPage,
    };
    // Assigned rather than spread so the key is absent (not `undefined`) on the happy path, which
    // is what keeps it out of the JSON the agent reads.
    if (probed.error !== undefined) file.error = probed.error;
    return file;
  });

  // Flagged after the fact rather than per entry: whether a name is ambiguous is a property of the
  // set, and it is the one thing that decides whether use_file can be called with a name at all.
  const counts = new Map<string, number>();
  for (const f of files) {
    if (f.fileName === null) continue;
    const key = f.fileName.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const f of files) {
    if (f.fileName === null) continue;
    if ((counts.get(f.fileName.trim().toLowerCase()) ?? 0) > 1) f.duplicateName = true;
  }

  return { files };
};
