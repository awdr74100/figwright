import type { SandboxToolHandler } from '../dispatcher.js';

export interface PingResult {
  apiVersion: string;
  editorType: 'figma' | 'figjam' | 'dev';
  currentPageId: string;
  currentPageName: string;
  fileKey: string | null;
  ts: number;
}

export const createPingHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  () => ({
    apiVersion: figmaCtx.apiVersion,
    editorType: figmaCtx.editorType,
    currentPageId: figmaCtx.currentPage.id,
    currentPageName: figmaCtx.currentPage.name,
    fileKey: figmaCtx.fileKey ?? null,
    ts: Date.now(),
  });
