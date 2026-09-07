import { describeSessions, type PluginSessionInfo, sessionsMatchingFile } from './sessions.js';

/**
 * Which Figma file _this_ server process sends its tool calls to.
 *
 * Routing is otherwise a property of the leader: it picks the most-recently-active plugin, which is
 * the file the user is looking at. That is the right answer for one agent — switch tabs and the
 * agent follows — and the wrong one for two, because "the foreground file" is a single global fact
 * while "the file I am working on" is per agent. Two agents on two files therefore both track
 * whichever tab is in front, and the one that isn't gets served another file's nodes with no error
 * at all (a node id from the wrong file spends ten seconds inside Figma and comes back as a network
 * failure).
 *
 * A target is per process, and there is one server process per MCP client, so binding one is how an
 * agent says "this one is mine" without taking the choice away from anyone else. Nothing is bound
 * by default: with a single plugin there is nothing to disambiguate, and follow-the-foreground
 * stays exactly as it was.
 */
export interface FileTarget {
  /**
   * The exact session bound. Preferred over the name on every lookup, because it cannot be
   * ambiguous — two files really can share a name, and `x (Copy)` is the common way it happens.
   */
  sessionId: string;
  /**
   * The file that session was in when it was bound. Not the identity — the recovery path. A plugin
   * panel closed and reopened comes back as a _new_ session id, and without a second handle the
   * binding would break every time a user reopened the panel. The name is what survives that.
   *
   * It is deliberately not `figma.fileKey`: that is the one true file identity, and public plugins
   * cannot read it (`fileKey` is gated behind `enablePrivatePluginApi`, and comes back null here —
   * verified live). Writing our own id into the file's plugin data was the other candidate and is
   * worse: a duplicated file inherits the id, so the two copies a user is most likely to have open
   * at once are exactly the two it cannot tell apart.
   */
  fileName: string | null;
}

/**
 * Where the list of connected sessions comes from. Two of these are passed around, and the
 * difference between them is the whole cost model:
 *
 * - A _connected_ source is free — the relay's own records, read locally or over one `/ping` — but
 *   its `fileName`s can be null, because a session only reports its file once its tab has been in
 *   the foreground _and_ the user has done something in it (see probeSessions).
 * - A _probing_ source asks each plugin directly, so every name is real, at the cost of one
 *   round-trip per session.
 *
 * Anything that has to match a name needs the probing one. Anything that only has to recognise an
 * id can use the free one, which is why the common path costs nothing.
 */
export type SessionSource = () => Promise<readonly PluginSessionInfo[]>;

/**
 * Resolution failed in a way that has to reach the agent instead of falling back to live routing.
 *
 * Falling back is what this whole module exists to prevent: an agent that asked for one file and
 * silently got another produces work that looks right and is built on the wrong design. Every
 * message below therefore names what was bound, what is connected now, and the call that fixes it.
 */
export class FileTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileTargetError';
  }
}

let target: FileTarget | null = null;

export const getFileTarget = (): FileTarget | null => target;

export const clearFileTarget = (): void => {
  target = null;
};

/** Test seam: restore module state between cases. */
export const setFileTarget = (next: FileTarget | null): void => {
  target = next;
};

export interface BindOutcome {
  target: FileTarget;
  sessions: readonly PluginSessionInfo[];
}

/**
 * Bind this process to one plugin session, by session id or by file name.
 *
 * An ambiguous name is refused rather than resolved. The alternative — take the most recently
 * active of the matches — would be a coin flip dressed as a decision, and the case it decides
 * wrongly (two copies of one file, both open) is the case a user is most likely to be in.
 */
export const bindFileTarget = async (
  probeSessions: SessionSource,
  request: { sessionId?: string; fileName?: string },
): Promise<BindOutcome> => {
  // Always the probing source, even for a bind by session id, so the name recorded alongside it is
  // real — that name is the only thing that can recover the binding when the panel is reopened.
  const sessions = await probeSessions();
  if (sessions.length === 0) {
    throw new FileTargetError(
      'no Figma file is connected — open the Figwright plugin in the file you want to work on, ' +
        'then call use_file again',
    );
  }

  if (request.sessionId !== undefined) {
    const match = sessions.find(s => s.id === request.sessionId);
    if (match === undefined) {
      throw new FileTargetError(
        `no connected session ${request.sessionId}. Connected now: ${describeSessions(sessions)}`,
      );
    }
    target = { sessionId: match.id, fileName: match.fileName };
    return { target, sessions };
  }

  if (request.fileName !== undefined) {
    const matches = sessionsMatchingFile(sessions, request.fileName);
    if (matches.length === 0) {
      throw new FileTargetError(
        `no connected file named "${request.fileName}". Connected now: ${describeSessions(sessions)}`,
      );
    }
    if (matches.length > 1) {
      throw new FileTargetError(
        `"${request.fileName}" matches ${matches.length} open files — Figma allows duplicate names, ` +
          `so the name alone cannot pick one. Call use_file again with one of these sessionIds: ` +
          `${matches.map(m => `${m.id} (page ${m.pageName ?? '?'})`).join(', ')}`,
      );
    }
    const only = matches[0] as PluginSessionInfo;
    target = { sessionId: only.id, fileName: only.fileName };
    return { target, sessions };
  }

  throw new FileTargetError('use_file needs either fileName or sessionId');
};

/**
 * The session id every call from this process should be pinned to, or undefined for live
 * (most-recently-active) routing.
 *
 * The ladder, in order:
 *
 * 1. Nothing bound — undefined. Untouched follow-the-foreground behaviour.
 * 2. The bound session is still connected — use it. The normal path, and exact.
 * 3. It is gone, and exactly one connected session carries the bound file name — the panel was
 *    reopened, so adopt the new session id. Safe to do silently _because_ it is unique among what
 *    is connected: there is no other file it could have meant.
 * 4. Anything else — throw. Zero matches means the file is not open; two or more means the name cannot
 *    choose, and guessing is the failure this exists to prevent.
 */
export const resolveFileTarget = async (
  connectedSessions: SessionSource,
  probeSessions: SessionSource,
): Promise<string | undefined> => {
  if (target === null) return undefined;

  // Recognising the bound id needs no names, so the free source answers the common case.
  if ((await connectedSessions()).some(s => s.id === target?.sessionId)) return target.sessionId;

  // Past here a name has to be matched, and the relay's cached names are unreliable — a session
  // that reconnected moments ago has none at all. Ask the plugins.
  const sessions = await probeSessions();
  if (sessions.some(s => s.id === target?.sessionId)) return target.sessionId;

  const bound = target.fileName;
  if (bound === null) {
    throw new FileTargetError(
      `the bound plugin session (${target.sessionId}) is gone and it never reported a file name, ` +
        `so it cannot be recovered. Connected now: ${describeSessions(sessions)}. ` +
        `Call use_file to pick one, or use_file({ release: true }) to follow the foreground file.`,
    );
  }

  const matches = sessionsMatchingFile(sessions, bound);
  if (matches.length === 1) {
    const only = matches[0] as PluginSessionInfo;
    target = { sessionId: only.id, fileName: only.fileName };
    return only.id;
  }

  throw new FileTargetError(
    matches.length === 0
      ? `"${bound}" is no longer connected — its Figwright panel was closed, or Figma was. ` +
          `Connected now: ${describeSessions(sessions)}. Reopen the plugin in "${bound}", ` +
          `or call use_file to switch, or use_file({ release: true }) to follow the foreground file.`
      : `"${bound}" now matches ${matches.length} open files, so the reopened panel cannot be ` +
          `identified by name. Call use_file with one of these sessionIds: ` +
          `${matches.map(m => `${m.id} (page ${m.pageName ?? '?'})`).join(', ')}`,
  );
};
