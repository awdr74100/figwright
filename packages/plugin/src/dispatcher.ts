import { ErrorCode } from '@figwright/shared';

import {
  createToolError,
  createToolResult,
  isPluginBridgeMessage,
  type PluginToolError,
  type PluginToolResult,
} from '../protocol/bridge.js';
import { withEditorContext } from '../protocol/editor-context.js';

export type SandboxToolHandler = (params: unknown) => unknown | Promise<unknown>;
export type SandboxHandlers = Record<string, SandboxToolHandler>;

const WRITE_HANDLERS = new WeakSet<SandboxToolHandler>();

/**
 * Mark a handler as one that writes, so an error it raises in an editor that refuses every write
 * names that editor. The registry marks the handlers it wraps as writes, so the split is the one it
 * already keeps rather than a second list.
 */
export const markWriteHandler = (handler: SandboxToolHandler): SandboxToolHandler => {
  WRITE_HANDLERS.add(handler);
  return handler;
};

/** Whether the registry marked this handler as a write. */
export const isWriteHandler = (handler: SandboxToolHandler): boolean => WRITE_HANDLERS.has(handler);

export interface DispatchInput {
  raw: unknown;
  handlers: SandboxHandlers;
  /**
   * `figma.editorType`, so a handler error can name the editor it was raised in. Required rather
   * than optional on purpose: an optional field is exactly the kind of claim that gets silently
   * dropped at one call site and never noticed (see `editor-context.ts`).
   */
  editorType: string;
  log?: (msg: string) => void;
}

export type DispatchOutcome =
  | { kind: 'reply'; reply: PluginToolResult | PluginToolError }
  | { kind: 'ignore' };

/**
 * Figma's own wording when a call it answers from its server gets no answer. It says to check the
 * internet connection, which sends an agent off to diagnose a network that was fine: measured, it
 * came and went while other calls in the same file kept working, in Figma Design and FigJam,
 * foreground or background, and only on calls Figma answers from its server — a lookup of an id the
 * file does not have loaded (a deleted one took 10 s to fail where it took 0.2–0.7 s to answer
 * null), a style by id, a reactions write.
 */
const FIGMA_SERVER_SILENT = /Unable to establish connection to Figma\b/;

const FIGMA_SERVER_SILENT_NOTE =
  "Figma's server did not answer this call. That comes and goes, and hits calls Figma answers " +
  'from its server — looking up an id this file does not have loaded (often a deleted or ' +
  'mistyped one), a style by id, a reactions write. Re-read any id that may be stale, bring the ' +
  'file to the front in Figma, and retry.';

/** An error's message, with what Figma's "check your internet connection" means appended. */
const explainFigmaServerSilence = (message: string): string =>
  FIGMA_SERVER_SILENT.test(message) ? `${message} (${FIGMA_SERVER_SILENT_NOTE})` : message;

export const dispatchSandboxMessage = async (input: DispatchInput): Promise<DispatchOutcome> => {
  if (!isPluginBridgeMessage(input.raw)) return { kind: 'ignore' };
  if (input.raw.kind !== 'tool-call') return { kind: 'ignore' };

  const { id, method, params } = input.raw;
  const handler = input.handlers[method];
  const log = input.log ?? ((): void => {});

  if (handler === undefined) {
    log(`[sandbox] no handler for ${method}`);
    return {
      kind: 'reply',
      reply: createToolError({
        id,
        code: ErrorCode.MethodNotFound,
        message: `no sandbox handler (method=${method})`,
      }),
    };
  }

  try {
    const result = await handler(params);
    return { kind: 'reply', reply: createToolResult({ id, result }) };
  } catch (err) {
    const raised = err instanceof Error ? err.message : String(err);
    log(`[sandbox] handler ${method} threw: ${raised}`);
    // FigJam and Dev Mode reject whole classes of call that Figma Design accepts, and the API's own
    // error rarely says which editor it came from. Naming it here is what lets an agent re-plan
    // instead of retrying the same call.
    return {
      kind: 'reply',
      reply: createToolError({
        id,
        code: ErrorCode.Internal,
        message: explainFigmaServerSilence(
          withEditorContext(err, input.editorType, isWriteHandler(handler)),
        ),
      }),
    };
  }
};
