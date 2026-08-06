import type { GetPromptResult, Prompt } from '@modelcontextprotocol/server';
import type { ZodType } from 'zod';

import { codeToFigmaPrompt } from './code-to-figma.js';
import { figmaToCodePrompt } from './figma-to-code.js';

// Single source of truth for the MCP prompts the server advertises. Prompts are the cross-client
// (Cursor / Windsurf / Claude Desktop) twin of the Claude Code skills — distilled guided workflows
// served over the protocol's prompts capability. Unlike tools, they have no plugin side, so this
// registry is server-only. index.ts registers each entry with McpServer.registerPrompt (which builds
// the advertised argument list from argsSchema). PROMPT_DEFINITIONS / buildPrompt remain as the
// pure, transport-free view the unit tests exercise.

/**
 * A prompt's argument shape. MCP prompt arguments are strings on the wire, so every member is a Zod
 * schema over `string` — an optional one simply arrives absent. Typing it this way instead of as a
 * bare `ZodRawShape` is what keeps the shape's meaning: `index.ts` can hand the builder straight to
 * `registerPrompt` with its return type still checked, where a widened shape forced a cast that
 * erased the whole callback signature.
 */
export type PromptArgsShape = Record<string, ZodType<string | undefined, string | undefined>>;

/** Arguments as they reach a prompt's builder: strings, with omitted optional ones absent. */
export type PromptArgs = Record<string, string | undefined>;

interface PromptEntry {
  definition: Prompt;
  argsSchema: PromptArgsShape;
  build: (args: PromptArgs | undefined) => GetPromptResult;
}

export const PROMPTS: readonly PromptEntry[] = [figmaToCodePrompt, codeToFigmaPrompt];

/** Prompt definitions in prompts/list order. */
export const PROMPT_DEFINITIONS: readonly Prompt[] = PROMPTS.map(p => p.definition);

/** Build a prompt's messages by name, or null when no such prompt is registered. */
export const buildPrompt = (name: string, args: PromptArgs | undefined): GetPromptResult | null =>
  PROMPTS.find(p => p.definition.name === name)?.build(args) ?? null;
