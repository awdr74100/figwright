import { describe, expect, it } from 'vitest';

import {
  GET_DOCUMENT_TOOL_NAME,
  getDocumentToolDefinition,
} from '../../src/tools/get-document.js';

describe('get_document tool definition', () => {
  it('exposes the canonical tool name', () => {
    expect(getDocumentToolDefinition.name).toBe(GET_DOCUMENT_TOOL_NAME);
    expect(GET_DOCUMENT_TOOL_NAME).toBe('get_document');
  });

  it('declares an empty object input schema', () => {
    expect(getDocumentToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
  });

  it('description mentions node tree / page', () => {
    const desc = getDocumentToolDefinition.description?.toLowerCase();
    expect(desc).toContain('tree');
    expect(desc).toContain('page');
  });
});
