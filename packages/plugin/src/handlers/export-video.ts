import type { VideoExport, VideoFormat } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

type VideoSettings = ExportSettingsMP4 | ExportSettingsGIF | ExportSettingsWEBM;

/**
 * Build the plugin-API video export settings from the validated tool params. fps is left loosely
 * typed (the MCP schema doesn't pin it to the exact per-format literals) — Figma validates the
 * value and rejects an unsupported one, which the handler surfaces as a `failed` reason.
 */
const buildVideoSettings = (
  format: VideoFormat,
  p: { fps?: unknown; quality?: unknown; loopCount?: unknown; constraint?: unknown },
): VideoSettings => {
  const settings: Record<string, unknown> = { format };
  if (typeof p.fps === 'number') settings.fps = p.fps;
  if (p.constraint !== undefined) settings.constraint = p.constraint;
  if (format === 'GIF') {
    if (typeof p.loopCount === 'number') settings.loopCount = p.loopCount;
  } else if (p.quality === 'LOW' || p.quality === 'MEDIUM' || p.quality === 'HIGH') {
    settings.quality = p.quality;
  }
  return settings as unknown as VideoSettings;
};

/**
 * Export an animated top-level frame to MP4 / GIF / WebM bytes (base64). We resolve the node's
 * enclosing top-level frame (video export rejects on any other node) and gate on the Figma Design
 * editor. exportAsync rejects for several reasons — a static frame with no animation, an
 * unsupported setting, or a render that raced another plugin call — so instead of collapsing them
 * into one guessed label we surface Figma's own message in `error`. Read-only: exporting doesn't
 * mutate the document.
 */
export const createExportVideoHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      format?: unknown;
      fps?: unknown;
      quality?: unknown;
      loopCount?: unknown;
      constraint?: unknown;
    };
    if (typeof p.nodeId !== 'string') throw new TypeError('export_video: nodeId must be a string');
    if (p.format !== 'MP4' && p.format !== 'GIF' && p.format !== 'WEBM') {
      throw new TypeError('export_video: format must be MP4, GIF, or WEBM');
    }
    const format = p.format;
    const miss = (nodeId: string, reason: VideoExport['reason'], error?: string): VideoExport => ({
      nodeId,
      format,
      base64: null,
      reason,
      ...(error !== undefined ? { error } : {}),
    });

    // Video export only exists in the Figma Design editor (no animation engine in FigJam / Dev Mode).
    if (figmaCtx.editorType !== 'figma') return miss(p.nodeId, 'wrong-editor');

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('getTopLevelFrame' in node)) return miss(p.nodeId, 'not-found');
    const frame = (node as SceneNode).getTopLevelFrame();
    if (frame === undefined || !('exportAsync' in frame))
      return miss(p.nodeId, 'no-top-level-frame');

    try {
      const bytes = await frame.exportAsync(buildVideoSettings(format, p));
      return { nodeId: frame.id, format, base64: figmaCtx.base64Encode(bytes) };
    } catch (err) {
      // exportAsync rejects for a static (no-animation) frame, a bad setting, or a raced render —
      // carry Figma's real message rather than guessing a single cause.
      const message = err instanceof Error ? err.message : String(err);
      return miss(frame.id, 'failed', message);
    }
  };
