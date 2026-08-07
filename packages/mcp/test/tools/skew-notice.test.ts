import type { CallToolResult } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import { withSkewNotice } from '../../src/tools/skew-notice.js';

const result = (text: string): CallToolResult => ({ content: [{ type: 'text', text }] });
const NOTICE = 'Figwright plugin v0.3.0 is older than this server (v0.4.0).';

/** A content block's text, or '' — the union also covers image/audio/resource blocks. */
const textOf = (from: CallToolResult, index: number): string => {
  const block = from.content[index];
  return block !== undefined && block.type === 'text' ? block.text : '';
};

describe('withSkewNotice', () => {
  it('appends the warning without disturbing the result the agent asked for', () => {
    const out = withSkewNotice(result('{"nodes":[]}'), 'read', NOTICE);

    expect(out.content).toHaveLength(2);
    expect(out.content[0]).toEqual({ type: 'text', text: '{"nodes":[]}' });
    expect(textOf(out, 1)).toContain(NOTICE);
  });

  it('separates the warning from the payload it warns about', () => {
    // Clients concatenate content blocks. Appended bare, the sentence runs straight on from the
    // result's closing brace and reads as part of the payload — seen against a real client, which
    // is why the separation is asserted rather than left to look right.
    const out = withSkewNotice(result('{"ok":true}'), 'write', NOTICE);
    const appended = textOf(out, 1);

    expect(appended.startsWith('\n\n')).toBe(true);
    expect(appended).toMatch(/OUT OF DATE/);
  });

  it('carries the warning on writes, where a silent partial apply is the actual risk', () => {
    expect(withSkewNotice(result('{"ok":true}'), 'write', NOTICE).content).toHaveLength(2);
  });

  it('leaves a local tool alone — it never reaches the plugin', () => {
    // Warning on a filesystem read would teach an agent to discount the warning that matters.
    const untouched = result('{"framework":"vue"}');
    expect(withSkewNotice(untouched, 'local', NOTICE)).toBe(untouched);
  });

  it('leaves every result alone when the plugin is current', () => {
    const untouched = result('{"nodes":[]}');
    expect(withSkewNotice(untouched, 'read', null)).toBe(untouched);
    expect(withSkewNotice(untouched, 'write', null)).toBe(untouched);
  });
});
