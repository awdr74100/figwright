import { AsyncLocalStorage } from 'node:async_hooks';

import type { CallToolResult } from '@modelcontextprotocol/server';

import type { ToolKind } from './spec.js';

/**
 * Per-tool-call capture of the skew warning, so the warning belongs to the call it is appended to.
 *
 * A module-level "last notice seen" was the first design and it was wrong twice over: the very
 * first call after the server starts had nothing recorded yet and so shipped unwarned — the single
 * most important call to get right — and internal dispatches (`ping` builds its own dispatch
 * context) never recorded at all. Async-local storage scopes it to the invocation instead, so
 * anything dispatched while a tool call is running reports into that call and nowhere else,
 * whatever layers sit between.
 */
const store = new AsyncLocalStorage<{ notice: string | null }>();

/**
 * The block appended to whatever a tool call produced.
 *
 * The leading break and the heading are why it is a block rather than a bare sentence: clients
 * concatenate content blocks, so appended raw it runs straight on from the payload's closing brace
 * and reads as part of it. One definition for both the success and the failure path — they carry
 * the same words, and having written it twice is how a heading drifts between them.
 */
const asBlock = (notice: string): string => `\n\n⚠️ FIGWRIGHT PLUGIN OUT OF DATE\n${notice}`;

/** Run a tool call with skew capture armed, then hand what was captured to `finish`. */
export const captureSkew = async (
  run: () => Promise<CallToolResult>,
  finish: (result: CallToolResult, notice: string | null) => CallToolResult,
): Promise<CallToolResult> => {
  const box = { notice: null as string | null };
  try {
    const result = await store.run(box, run);
    return finish(result, box.notice);
  } catch (err) {
    // A failure needs the warning as much as a result does — more, arguably: an out-of-date plugin
    // answers METHOD_NOT_FOUND for every tool it predates, and unattributed that reads as "this
    // tool is broken", so the agent goes looking for another way to do the same thing. The SDK
    // turns a thrown error into the tool result the model sees, so the message is where it has to
    // go; `finish` never runs on this path.
    if (box.notice === null) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}${asBlock(box.notice)}`, { cause: err });
  }
};

/**
 * Report the plugin that served a dispatch. A no-op outside a tool call — internal callers
 * (election probes, the leader's own RPC endpoint) dispatch with no call to attribute to.
 */
export const reportSkew = (notice: string | null): void => {
  const box = store.getStore();
  // Only ever set, never cleared: one tool call can dispatch to several plugins (a multi-call tool
  // pins one session, but ping and the map tools do not), and if any of them is out of date the
  // result as a whole is unverified.
  if (box !== undefined && notice !== null) box.notice = notice;
};

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
    content: [...result.content, { type: 'text' as const, text: asBlock(notice) }],
  };
};
