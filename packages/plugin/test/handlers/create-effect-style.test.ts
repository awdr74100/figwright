import type { StyleResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createCreateEffectStyleHandler } from '../../src/handlers/create-effect-style.js';

const fakeFigma = (): { figma: typeof figma; style: Record<string, unknown> } => {
  const style: Record<string, unknown> = { id: 'E:0', name: '' };
  const figmaCtx = { createEffectStyle: () => style } as unknown as typeof figma;
  return { figma: figmaCtx, style };
};

describe('create_effect_style handler', () => {
  it('creates an effect style from a blur effect', async () => {
    const { figma: f, style } = fakeFigma();
    const handler = createCreateEffectStyleHandler(f);
    const result = (await handler({
      name: 'Elevation/Blur',
      effects: [{ type: 'LAYER_BLUR', visible: true, radius: 8 }],
    })) as StyleResult;

    expect(style.effects).toEqual([{ type: 'LAYER_BLUR', visible: true, radius: 8 }]);
    expect(result).toEqual({ ok: true, styleId: 'E:0', name: 'Elevation/Blur' });
  });

  it('throws on bad input', async () => {
    const { figma: f } = fakeFigma();
    const handler = createCreateEffectStyleHandler(f);
    await expect(handler({ effects: [] })).rejects.toThrow(/name/);
    await expect(handler({ name: 'x', effects: 'no' })).rejects.toThrow(/effects/);
  });
});
