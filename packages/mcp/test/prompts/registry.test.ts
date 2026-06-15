import { describe, expect, it } from 'vitest';

import { CODE_TO_FIGMA_PROMPT_NAME } from '../../src/prompts/code-to-figma.js';
import { FIGMA_TO_CODE_PROMPT_NAME } from '../../src/prompts/figma-to-code.js';
import { buildPrompt, PROMPT_DEFINITIONS } from '../../src/prompts/registry.js';

const textOf = (name: string, args?: Record<string, string>): string => {
  const result = buildPrompt(name, args);
  const content = result?.messages[0]?.content;
  return content !== undefined && content.type === 'text' ? content.text : '';
};

describe('prompts registry', () => {
  it('advertises figma_to_code with an optional nodeId argument', () => {
    const def = PROMPT_DEFINITIONS.find(p => p.name === FIGMA_TO_CODE_PROMPT_NAME);
    expect(def).toBeDefined();
    expect(def?.description).toBeTruthy();
    const nodeArg = def?.arguments?.find(a => a.name === 'nodeId');
    expect(nodeArg).toBeDefined();
    expect(nodeArg?.required).toBe(false);
  });

  it('builds the workflow against the current selection when no nodeId is given', () => {
    const text = textOf(FIGMA_TO_CODE_PROMPT_NAME);
    expect(text).toContain('current Figma selection');
    // names the three grounded tools and the core reuse rule
    expect(text).toContain('get_design_context');
    expect(text).toContain('component_map');
    expect(text).toContain('token_map');
    expect(text).toContain('unmatchedProps');
  });

  it('interpolates a provided nodeId into the workflow', () => {
    const text = textOf(FIGMA_TO_CODE_PROMPT_NAME, { nodeId: '15131:1478' });
    expect(text).toContain('15131:1478');
    expect(text).not.toContain('the current Figma selection');
  });

  it('advertises code_to_figma (no args) with the build workflow', () => {
    const def = PROMPT_DEFINITIONS.find(p => p.name === CODE_TO_FIGMA_PROMPT_NAME);
    expect(def).toBeDefined();
    expect(def?.description).toBeTruthy();
    expect(def?.arguments).toEqual([]);

    const text = textOf(CODE_TO_FIGMA_PROMPT_NAME);
    // names the discovery + write tools and the colour-binding gotcha (paint, not node)
    expect(text).toContain('get_variable_defs');
    expect(text).toContain('create_instance');
    expect(text).toContain('bind_variable_to_paint');
    expect(text).toContain('reuse beats regenerate');
  });

  it('returns null for an unknown prompt name', () => {
    expect(buildPrompt('does_not_exist', undefined)).toBeNull();
  });
});
