/** The sandbox hands a host turn to the panel, which replies from a message task, not a timer. */
export const HOST_YIELD_TAG = '@figwright/yield';

interface HostYieldBase {
  tag: typeof HOST_YIELD_TAG;
  id: number;
}

export type HostYieldMessage = HostYieldBase &
  ({ kind: 'yield-request' } | { kind: 'yield-resume'; background: boolean });

export const createHostYield = (
  id: number,
  kind: HostYieldMessage['kind'],
  background = false,
): HostYieldMessage =>
  kind === 'yield-request'
    ? { tag: HOST_YIELD_TAG, kind, id }
    : { tag: HOST_YIELD_TAG, kind, id, background };

/** Both ends ship together; only the tag, direction and correlation id cross this channel. */
export const parseHostYield = (raw: unknown): HostYieldMessage | null => {
  if (raw === null || typeof raw !== 'object') return null;
  const message = raw as Record<string, unknown>;
  if (message.tag !== HOST_YIELD_TAG) return null;
  if (message.kind !== 'yield-request' && message.kind !== 'yield-resume') return null;
  if (message.kind === 'yield-resume' && typeof message.background !== 'boolean') return null;
  if (typeof message.id !== 'number' || !Number.isSafeInteger(message.id) || message.id <= 0)
    return null;
  return createHostYield(message.id, message.kind, message.background === true);
};
