import {
  CLIENT_MESSAGE_LIMIT_BYTES,
  type SearchNodesResult,
  TOOL_RESULT_BUDGET_BYTES,
} from '@figwright/shared';
import type { CallToolResult } from '@modelcontextprotocol/server';

// Two nets for the client message limit (see `@figwright/shared`'s result-budget.ts):
//
//   fitNodeList        — search / scan results, which can be cut cleanly: a prefix of a document-order
//                        list is still a true answer about the nodes it holds, once a note says how
//                        many there are in all. Trimmed to the budget.
//   assertWithinLimit  — every tool, after everything else: a result that would still cross the hard
//                        limit is refused with a message instead of being sent and taking the
//                        connection down with it.

const megabytes = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

/** Bytes `text` occupies as a JSON string inside the JSON-RPC line: escaped, then UTF-8. */
const wireBytes = (text: string): number => Buffer.byteLength(JSON.stringify(text), 'utf8') - 2;

/**
 * Trim a node-list result to what one tool result can carry. A list that fits is returned as is.
 * Otherwise the leading nodes that fit are kept, `matchCount` says how many matched in all, and a
 * note — first, so it is read before the data — says what was left out and how to reach it.
 *
 * The plugin already stops serializing once a list is certain not to fit (its estimate is a lower
 * bound), so `matchCount` may arrive set with `nodes` holding only a prefix. This side measures the
 * exact bytes the text block will occupy and cuts precisely.
 *
 * `narrowWith` names the arguments that shrink this tool's result, for the note.
 */
export const fitNodeList = (
  result: SearchNodesResult,
  narrowWith: string,
  budgetBytes = TOOL_RESULT_BUDGET_BYTES,
): SearchNodesResult => {
  const total = result.matchCount ?? result.nodes.length;
  const sizes = result.nodes.map(node => wireBytes(JSON.stringify(node)));
  const noteFor = (kept: number): string =>
    `Showing the first ${kept.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ` +
    'matching nodes, in document order: they do not all fit in one tool result ' +
    `(${megabytes(budgetBytes)} MB). To reach the rest, narrow the call — ${narrowWith}.`;
  const shell = (kept: number): number =>
    wireBytes(JSON.stringify({ note: noteFor(kept), matchCount: total, nodes: [] }));

  if (total === result.nodes.length) {
    const whole = wireBytes(JSON.stringify({ nodes: [] })) + sizes.reduce((a, b) => a + b, 0);
    if (whole + Math.max(0, sizes.length - 1) <= budgetBytes) return result;
  }
  // The note's own length depends on the count it names; sizing the shell with the most digits the
  // count can have keeps the final note within what was reserved for it.
  let used = shell(total);
  let kept = 0;
  while (kept < sizes.length) {
    const next = used + sizes[kept]! + (kept > 0 ? 1 : 0);
    if (next > budgetBytes) break;
    used = next;
    kept += 1;
  }
  return { note: noteFor(kept), matchCount: total, nodes: result.nodes.slice(0, kept) };
};

// What rides around the content blocks: the JSON-RPC envelope and the result's own keys.
const ENVELOPE_MARGIN_BYTES = 64 * 1024;

/**
 * Refuse a result that would cross the client's message limit. Sending it is not a failed call but
 * a lost connection — every later call fails until the user reconnects by hand — so an error the
 * caller can act on is strictly better. Measured only when a block is large enough that it might
 * matter: a string's escaped UTF-8 form is at most six bytes per UTF-16 unit.
 */
export const assertWithinLimit = (
  tool: string,
  result: CallToolResult,
  limitBytes = CLIENT_MESSAGE_LIMIT_BYTES - ENVELOPE_MARGIN_BYTES,
): CallToolResult => {
  const blocks = result.content as ReadonlyArray<{ text?: unknown; data?: unknown }>;
  let ceiling = 0;
  for (const block of blocks) {
    if (typeof block.text === 'string') ceiling += block.text.length * 6;
    if (typeof block.data === 'string') ceiling += block.data.length;
  }
  if (ceiling <= limitBytes) return result;
  const bytes = Buffer.byteLength(JSON.stringify(result.content), 'utf8');
  if (bytes <= limitBytes) return result;
  throw new Error(
    `${tool}: the result is ${megabytes(bytes)} MB, more than the ` +
      `${megabytes(CLIENT_MESSAGE_LIMIT_BYTES)} MB one MCP message can carry — sending it would ` +
      'drop the connection to this server. Ask for less in one call: scope it to a smaller subtree ' +
      'or split it into several calls.',
  );
};
