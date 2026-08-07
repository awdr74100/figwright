import type { CallToolResult } from '@modelcontextprotocol/server';

import type { ToolKind } from './spec.js';

/**
 * Append the plugin-skew warning to a tool result.
 *
 * This is the whole mechanism that replaced refusing an old plugin: the call runs, and the agent is
 * told on the same turn that the result may be incomplete. It has to ride on every affected result
 * rather than be available on request, because the failure it describes is invisible — an older
 * handler drops arguments it predates and still answers `{ ok: true }`, so nothing in the payload
 * hints that anything is missing, and an agent with no reason to ask never asks.
 *
 * Extracted from the registration loop so it is reachable by a test; the live path is otherwise
 * only exercised by running the server against a genuinely old plugin.
 */
export const withSkewNotice = (
  result: CallToolResult,
  kind: ToolKind,
  notice: string | null,
): CallToolResult => {
  // `local` tools read the filesystem and never reach the plugin, so its version says nothing about
  // their result. Warning there would train an agent to discount the warning where it matters.
  if (kind === 'local' || notice === null) return result;
  return {
    ...result,
    content: [
      ...result.content,
      {
        type: 'text' as const,
        // Break + heading because clients concatenate content blocks: appended bare, the sentence
        // runs straight on from the result's closing brace and reads as payload rather than as a
        // warning about it (seen against a real client). The notice itself stays unadorned — the
        // plugin's own panel renders the same string as a banner.
        text: `\n\n⚠️ FIGWRIGHT PLUGIN OUT OF DATE\n${notice}`,
      },
    ],
  };
};
