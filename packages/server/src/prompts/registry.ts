import type { GetPromptResult, Prompt } from '@modelcontextprotocol/sdk/types.js';

import { figmaToCodePrompt } from './figma-to-code.js';

// Single source of truth for the MCP prompts the server advertises. Prompts are the cross-client
// (Cursor / Windsurf / Claude Desktop) twin of the Claude Code skills — distilled guided workflows
// served over the protocol's prompts capability. Unlike tools, they have no plugin side, so this
// registry is server-only. index.ts consumes PROMPT_DEFINITIONS (prompts/list) and buildPrompt
// (prompts/get).

interface PromptEntry {
  definition: Prompt;
  build: (args: Record<string, string> | undefined) => GetPromptResult;
}

const PROMPTS: readonly PromptEntry[] = [figmaToCodePrompt];

/** Prompt definitions in prompts/list order. */
export const PROMPT_DEFINITIONS: readonly Prompt[] = PROMPTS.map(p => p.definition);

/** Build a prompt's messages by name, or null when no such prompt is registered. */
export const buildPrompt = (
  name: string,
  args: Record<string, string> | undefined,
): GetPromptResult | null => PROMPTS.find(p => p.definition.name === name)?.build(args) ?? null;
