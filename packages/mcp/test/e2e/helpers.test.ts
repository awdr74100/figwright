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

const BYTES = Buffer.from(SAMPLE, 'utf8');

/** The sample cut at the given byte offsets, in ascending order. */
const cutAt = (...offsets: number[]): Buffer[] =>
  [0, ...offsets].map((start, i) => BYTES.subarray(start, offsets[i] ?? BYTES.length));

/** Every offset strictly inside the sample — each one a boundary a pipe could put there. */
const OFFSETS = Array.from({ length: BYTES.length - 1 }, (_, i) => i + 1);

describe('onText', () => {
  it('keeps every character whole when one boundary splits the text, wherever it falls', async () => {
    const decoded = await Promise.all(OFFSETS.map(a => decodeInPieces(cutAt(a))));
    expect(decoded.filter(text => text !== SAMPLE)).toEqual([]);
  });

  it('keeps every character whole when two boundaries split the text, wherever they fall', async () => {
    // Two boundaries can land inside the same three- or four-byte character, leaving its middle
    // byte(s) a chunk of their own — a case a single boundary never produces.
    const pairs = OFFSETS.flatMap(a => OFFSETS.filter(b => b > a).map(b => [a, b]));
    const decoded = await Promise.all(pairs.map(pair => decodeInPieces(cutAt(...pair))));
    expect(decoded.filter(text => text !== SAMPLE)).toEqual([]);
  });

  it('keeps every character whole when the text arrives one byte per chunk', async () => {
    expect(await decodeInPieces(cutAt(...OFFSETS))).toBe(SAMPLE);
  });
});
