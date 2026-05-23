import { decode, encode } from '@msgpack/msgpack';
import * as v from 'valibot';

import { type Envelope, EnvelopeSchema } from './envelope.js';

export const encodeEnvelope = (envelope: Envelope): Uint8Array<ArrayBuffer> =>
  encode(envelope) as Uint8Array<ArrayBuffer>;

export const decodeEnvelope = (bytes: Uint8Array | ArrayBuffer): Envelope => {
  const buffer = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const raw = decode(buffer);
  return v.parse(EnvelopeSchema, raw);
};
