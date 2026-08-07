import type { CallToolResult } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import { captureSkew, reportSkew, withSkewNotice } from '../../src/tools/skew-notice.js';

const result = (text: string): CallToolResult => ({ content: [{ type: 'text', text }] });
const NOTICE = 'Figwright plugin v0.3.0 is older than this server (v0.4.0).';

/** A content block's text, or '' — the union also covers image/audio/resource blocks. */
const textOf = (from: CallToolResult, index: number): string => {
  const block = from.content[index];
  return block !== undefined && block.type === 'text' ? block.text : '';
};

describe('captureSkew', () => {
  it('scopes a report to the call that caused it', async () => {
    const captured = await captureSkew(
      async () => {
        reportSkew(NOTICE);
        return result('{}');
      },
      (r, notice) => withSkewNotice(r, 'read', notice),
    );

    expect(captured.content).toHaveLength(2);
  });

  it('carries the warning on the very first call, not from the call before', async () => {
    // The predecessor to this was a module-level "last notice seen", which had nothing recorded
    // when the first call ran — so the first tool call after the server started shipped unwarned.
    // That is the call most likely to be a write, and the one an agent is most likely to trust.
    let first: string | null = 'unset';
    await captureSkew(
      async () => {
        reportSkew(NOTICE);
        return result('{}');
      },
      (r, notice) => {
        first = notice;
        return r;
      },
    );

    expect(first).toBe(NOTICE);
  });

  it('does not leak a warning into the next call', async () => {
    await captureSkew(
      async () => {
        reportSkew(NOTICE);
        return result('{}');
      },
      r => r,
    );

    // The plugin was updated between calls; this one must come back clean.
    let second: string | null = 'unset';
    await captureSkew(
      async () => result('{}'),
      (r, notice) => {
        second = notice;
        return r;
      },
    );

    expect(second).toBeNull();
  });

  it('keeps the warning when a call reaches several plugins and any one is old', async () => {
    // ping and the map tools dispatch more than once; if any plugin involved is out of date the
    // result as a whole is unverified, so a later clean report must not clear an earlier warning.
    let notice: string | null = 'unset';
    await captureSkew(
      async () => {
        reportSkew(NOTICE);
        reportSkew(null);
        return result('{}');
      },
      (r, n) => {
        notice = n;
        return r;
      },
    );

    expect(notice).toBe(NOTICE);
  });

  it('attaches the warning to a failure, where it explains the failure', async () => {
    // The loudest thing an out-of-date plugin does is answer METHOD_NOT_FOUND for a tool it
    // predates — nine of them for the last shipped build. Unattributed, an agent reads that as
    // "this tool is broken" and looks for another way round, which is the same misdirection as a
    // silent wrong write.
    await expect(
      captureSkew(
        async () => {
          reportSkew(NOTICE);
          throw new Error('METHOD_NOT_FOUND: no sandbox handler (method=export_video)');
        },
        r => r,
      ),
    ).rejects.toThrow(/METHOD_NOT_FOUND[\s\S]*OUT OF DATE[\s\S]*older than this server/);
  });

  it('leaves a failure untouched when the plugin is current', async () => {
    const original = new Error('node not found');
    await expect(
      captureSkew(
        () => Promise.reject(original),
        r => r,
      ),
    ).rejects.toBe(original);
  });

  it('ignores a report made outside any call', () => {
    // Election probes and the leader's own RPC endpoint dispatch with no tool call to attribute to.
    expect(() => reportSkew(NOTICE)).not.toThrow();
  });
});

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
