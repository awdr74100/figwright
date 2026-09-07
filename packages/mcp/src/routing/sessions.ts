/**
 * What one connected plugin session looks like to anything that has to choose between them.
 *
 * The leader reads this straight off its `Session` records; a follower gets the same shape back
 * from the leader's `/ping`. One type for both so the two roles cannot answer "which files are
 * open?" differently — the whole point of file targeting is that every process agrees on the list.
 */
export interface PluginSessionInfo {
  id: string;
  /**
   * The file this session's plugin is running in, from its last `$activity` event. Null until that
   * session has pushed one — a panel opened while its tab was in the background never emits (the
   * event is visibility-gated so a background file can't steal routing), so null is a real state,
   * not just a startup race. `list_files` fills those in by asking each plugin directly.
   */
  fileName: string | null;
  pageName: string | null;
  lastActivityAt: number;
  pluginVersion: string;
}

/**
 * Sessions whose `fileName` matches, case-insensitively and ignoring surrounding whitespace.
 *
 * Case-insensitive because the name is something a user typed or an agent read off a previous
 * result, and refusing "brand" for "Brand" would be a papercut with no upside — the exact-match
 * candidates are returned as a list either way, so nothing is silently resolved.
 */
export const sessionsMatchingFile = (
  sessions: readonly PluginSessionInfo[],
  fileName: string,
): readonly PluginSessionInfo[] => {
  const wanted = fileName.trim().toLowerCase();
  return sessions.filter(s => s.fileName !== null && s.fileName.trim().toLowerCase() === wanted);
};

/** Render the connected sessions for an error message an agent has to act on. */
export const describeSessions = (sessions: readonly PluginSessionInfo[]): string => {
  if (sessions.length === 0) return 'none';
  return sessions.map(s => `${s.fileName ?? '(unnamed)'} [${s.id}]`).join(', ');
};
