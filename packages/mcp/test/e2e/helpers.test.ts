import { once } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { onText } from './_helpers.js';

// The e2e suites read real pipes, whose chunk boundaries are chosen by the OS and the reading Node
// and cannot be steered from a test. A PassThrough written in pieces puts a boundary exactly where
// it is wanted, so every split a pipe could make is exercised here instead of waiting for one to
// land inside a character on some runner.

/** Two-, three- and four-byte sequences, each next to ASCII so a cut can fall on either side. */
const SAMPLE = 'é get_node_motion’s raw read — 界 😀.';

const decodeInPieces = async (pieces: Buffer[]): Promise<string> => {
  const stream = new PassThrough();
  let received = '';
  onText(stream, text => {
    received += text;
  });
  for (const piece of pieces) stream.write(piece);
  stream.end();
  await once(stream, 'end');
  return received;
};

describe('onText', () => {
  it('keeps a character whole when one chunk boundary splits it, wherever the boundary falls', async () => {
    const bytes = Buffer.from(SAMPLE, 'utf8');
    const decoded = await Promise.all(
      Array.from({ length: bytes.length - 1 }, (_, i) =>
        decodeInPieces([bytes.subarray(0, i + 1), bytes.subarray(i + 1)]),
      ),
    );
    expect(decoded.filter(text => text !== SAMPLE)).toEqual([]);
  });

  it('keeps a four-byte character whole when it arrives one byte per chunk', async () => {
    const bytes = Buffer.from('😀', 'utf8');
    const pieces = Array.from(bytes, (_, i) => bytes.subarray(i, i + 1));
    expect(await decodeInPieces(pieces)).toBe('😀');
  });
});
