import {
  createToolError,
  createToolResult,
  ErrorCode,
  isPluginBridgeMessage,
  type PluginToolError,
  type PluginToolResult,
} from '@figwright/shared';

export type SandboxToolHandler = (params: unknown) => unknown | Promise<unknown>;
export type SandboxHandlers = Record<string, SandboxToolHandler>;

export interface DispatchInput {
  raw: unknown;
  handlers: SandboxHandlers;
  log?: (msg: string) => void;
}

export type DispatchOutcome =
  | { kind: 'reply'; reply: PluginToolResult | PluginToolError }
  | { kind: 'ignore' };

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
    const message = err instanceof Error ? err.message : String(err);
    log(`[sandbox] handler ${method} threw: ${message}`);
    return {
      kind: 'reply',
      reply: createToolError({ id, code: ErrorCode.Internal, message }),
    };
  }
};
