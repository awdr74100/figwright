import { z } from 'zod';

import type { PluginSessionInfo } from '../routing/sessions.js';
import {
  bindFileTarget,
  clearFileTarget,
  type FileTarget,
  getFileTarget,
  type SessionSource,
} from '../routing/target.js';
import {
  type ConnectedFile,
  handleListFiles,
  namedSessions,
  type SessionDispatch,
} from './list-files.js';
import type { ToolSpec } from './spec.js';

export const USE_FILE_TOOL_NAME = 'use_file';

export const useFileTool: ToolSpec = {
  name: USE_FILE_TOOL_NAME,
  description:
    'Claim one open Figma file for this agent, so its tool calls stop following whichever file the ' +
    'user last touched. Call this when list_files or ping shows more than one file connected — ' +
    'without it two agents working on two files both track the foreground tab, and the one that ' +
    'is not in front silently reads and writes the wrong file. Pass fileName (refused when two ' +
    'open files share it) or sessionId (always unambiguous; take it from list_files). ' +
    'release: true drops the claim and goes back to following the foreground file. The claim lasts ' +
    'for this server process only, so it never affects another agent, and it survives the user ' +
    'closing and reopening the plugin panel (the file is re-found by name). Returns the claim plus ' +
    'the same file list as list_files.',
  inputSchema: z.object({
    fileName: z
      .string()
      .optional()
      .describe('Name of the open file to claim; refused if two open files share it'),
    sessionId: z
      .string()
      .optional()
      .describe('Exact plugin session to claim, from list_files — never ambiguous'),
    release: z
      .boolean()
      .optional()
      .describe('Drop the claim and go back to following the foreground file'),
  }),
  // Never reaches the plugin: the claim is state in this server process. The file list it returns
  // is gathered by dispatching `list_files`, which records its own arguments.
  kind: 'local',
  serverOnlyArgs: null,
};

export interface UseFileResult {
  bound: FileTarget | null;
  files: ConnectedFile[];
}

export const handleUseFile = async (
  args: { fileName?: string; sessionId?: string; release?: boolean },
  listSessions: SessionSource,
  dispatch: SessionDispatch,
): Promise<UseFileResult> => {
  if (args.release === true) {
    clearFileTarget();
  } else if (args.fileName !== undefined || args.sessionId !== undefined) {
    // Bound against the plugins' own answers, not the relay's cached names: a session that
    // reconnected moments ago — which every leader handover and server restart causes — has not
    // reported a name yet, and matching against that cache would refuse a file that is plainly open.
    // Throws when the file can't be picked; never falls back to live routing, which would answer
    // "bound" while serving somebody else's file.
    await bindFileTarget(async () => namedSessions(await listSessions(), dispatch), args);
  }
  // No arguments at all is a read: "what is claimed, and what could be?" — the same question
  // list_files answers, so it answers it the same way rather than erroring.

  const sessions: readonly PluginSessionInfo[] = await listSessions();
  const { files } = await handleListFiles(sessions, dispatch);
  return { bound: getFileTarget(), files };
};
