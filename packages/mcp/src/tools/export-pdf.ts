import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { ExportPdfResult, PdfExport } from '@figwright/shared';
import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const EXPORT_PDF_TOOL_NAME = 'export_pdf';

const inputShape = {
  nodeId: z
    .string()
    .describe(
      'Node to export to a one-page PDF (a frame / section / component); omit for the current page',
    )
    .optional(),
  outPath: z.string().describe('File path to write the .pdf to (parent dirs created if missing)'),
};

export const exportPdfTool: ToolSpec = {
  name: EXPORT_PDF_TOOL_NAME,
  description:
    'Export a node (or the current page) to a single PDF file on disk: { nodeId, path, empty? }. ' +
    "Renders the target as one PDF page — Figma's plugin API exports one page per node and cannot " +
    'paginate a page into one-frame-per-page or combine multiple nodes into a multi-page file. Pass a ' +
    'frame / section id for a vector PDF of that node; omit nodeId for the current page (large pages ' +
    'can be slow). path is null if the target is missing or not exportable; empty:true means it ' +
    'rendered nothing (blank PDF).',
  inputShape,
  kind: 'local',
};

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Land the exported PDF bytes on the server filesystem. Pure-fs and dispatch-free so it can be
 * unit-tested against a temp directory.
 */
export const writeExportedPdf = async (
  outPath: string,
  pdf: PdfExport,
): Promise<ExportPdfResult> => {
  const empty = pdf.empty === true ? { empty: true } : {};
  if (pdf.base64 === null) return { nodeId: pdf.nodeId, path: null, ...empty };
  const path = resolve(outPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(pdf.base64, 'base64'));
  return { nodeId: pdf.nodeId, path, ...empty };
};

/** Reuses the plugin-side export_pdf handler to fetch base64 bytes, then writes them to disk. */
export const handleExportPdf = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<ExportPdfResult> => {
  const args = z.object(inputShape).parse(rawArgs);
  const pluginArgs: Record<string, unknown> = {};
  if (args.nodeId !== undefined) pluginArgs.nodeId = args.nodeId;
  const pdf = (await dispatch(EXPORT_PDF_TOOL_NAME, pluginArgs)) as PdfExport;
  return writeExportedPdf(args.outPath, pdf);
};
