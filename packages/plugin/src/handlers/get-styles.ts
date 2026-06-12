import type { GetStylesResult, SerializedLineHeight } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeEffect, serializeLayoutGrid, serializePaint } from '../serializer.js';

const serializeLineHeight = (lh: LineHeight): SerializedLineHeight =>
  lh.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: lh.unit, value: lh.value };

export const createGetStylesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async () => {
    const [paintStyles, textStyles, effectStyles, gridStyles] = await Promise.all([
      figmaCtx.getLocalPaintStylesAsync(),
      figmaCtx.getLocalTextStylesAsync(),
      figmaCtx.getLocalEffectStylesAsync(),
      figmaCtx.getLocalGridStylesAsync(),
    ]);

    const result: GetStylesResult = {
      paints: paintStyles.map(s => ({
        id: s.id,
        name: s.name,
        key: s.key,
        description: s.description,
        paints: s.paints.map(serializePaint),
      })),
      texts: textStyles.map(s => ({
        id: s.id,
        name: s.name,
        key: s.key,
        description: s.description,
        fontName: { family: s.fontName.family, style: s.fontName.style },
        fontSize: s.fontSize,
        lineHeight: serializeLineHeight(s.lineHeight),
        letterSpacing: { unit: s.letterSpacing.unit, value: s.letterSpacing.value },
      })),
      effects: effectStyles.map(s => ({
        id: s.id,
        name: s.name,
        key: s.key,
        description: s.description,
        effects: s.effects.map(serializeEffect),
      })),
      grids: gridStyles.map(s => ({
        id: s.id,
        name: s.name,
        key: s.key,
        description: s.description,
        grids: s.layoutGrids.map(serializeLayoutGrid),
      })),
    };
    return result;
  };
