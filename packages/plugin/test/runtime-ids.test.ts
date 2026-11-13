import { afterEach, describe, expect, it } from 'vitest';

import {
  isRuntimeSpent,
  noteRuntimeError,
  resetRuntimeForTests,
  RUNTIME_SPENT_NOTE,
  runtimeSpentError,
} from '../src/runtime-ids.js';

afterEach(resetRuntimeForTests);

describe('runtime ids', () => {
  it('is marked spent only by the overflow error, whose id is negative', () => {
    expect(noteRuntimeError(new Error('Variable not found'))).toBe(false);
    expect(noteRuntimeError(new Error('Attempted to invoke callback with invalid id 12'))).toBe(
      false,
    );
    expect(isRuntimeSpent()).toBe(false);
    expect(
      noteRuntimeError(
        new Error('in <unknown>: Attempted to invoke callback with invalid id -32761'),
      ),
    ).toBe(true);
    expect(isRuntimeSpent()).toBe(true);
  });

  it('reads a thrown string as well as an Error', () => {
    expect(noteRuntimeError('Attempted to invoke callback with invalid id -1')).toBe(true);
  });

  it('names the tool and what it could not do, then the one step that recovers', () => {
    expect(runtimeSpentError('import_image', 'create the image').message).toBe(
      `import_image: could not create the image. ${RUNTIME_SPENT_NOTE}`,
    );
    expect(RUNTIME_SPENT_NOTE).toMatch(/reopen the plugin/);
  });
});
