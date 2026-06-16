import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExportPdfResult, PdfExport } from '@figwright/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EXPORT_PDF_TOOL_NAME,
  exportPdfTool,
  handleExportPdf,
  type ToolDispatcher,
  writeExportedPdf,
} from '../../src/tools/export-pdf.js';
import { toToolDefinition } from '../tool-schema.js';

const exportPdfToolDefinition = toToolDefinition(exportPdfTool);

const dirs: string[] = [];
const makeDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'export-pdf-'));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

describe('export_pdf — definition', () => {
  it('requires outPath and declares nodeId optional', () => {
    expect(exportPdfToolDefinition.name).toBe(EXPORT_PDF_TOOL_NAME);
    expect(exportPdfToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      required: ['outPath'],
      properties: { nodeId: { type: 'string' }, outPath: { type: 'string' } },
    });
  });
});

describe('writeExportedPdf', () => {
  it('writes the bytes to outPath, creating missing parent dirs', async () => {
    const base = await makeDir();
    const path = join(base, 'nested', 'handoff.pdf');
    const pdf: PdfExport = { nodeId: '0:1', base64: 'AAAA' };
    const result = await writeExportedPdf(path, pdf);

    expect(result).toEqual({ nodeId: '0:1', path });
    expect((await readFile(path)).toString('base64')).toBe('AAAA');
  });

  it('returns path null without writing when base64 is null', async () => {
    const dir = await makeDir();
    const path = join(dir, 'x.pdf');
    const result = await writeExportedPdf(path, { nodeId: '9:9', base64: null });
    expect(result).toEqual({ nodeId: '9:9', path: null });
    await expect(readFile(path)).rejects.toThrow(/ENOENT/);
  });

  it('passes the empty flag through (file still written)', async () => {
    const dir = await makeDir();
    const path = join(dir, 'blank.pdf');
    const result = await writeExportedPdf(path, { nodeId: '5:5', base64: 'AAAA', empty: true });
    expect(result).toEqual({ nodeId: '5:5', path, empty: true });
  });
});

describe('handleExportPdf', () => {
  it('dispatches export_pdf (current page when nodeId omitted) and writes the file', async () => {
    const dir = await makeDir();
    const path = join(dir, 'page.pdf');
    let dispatched: { tool: string; args: unknown } | null = null;
    const dispatch: ToolDispatcher = async (tool, args) => {
      dispatched = { tool, args };
      return { nodeId: '0:1', base64: 'AAAA' } satisfies PdfExport;
    };

    const result = (await handleExportPdf(dispatch, { outPath: path })) as ExportPdfResult;

    expect(dispatched).toEqual({ tool: 'export_pdf', args: {} });
    expect(result).toEqual({ nodeId: '0:1', path });
    expect((await readFile(path)).toString('base64')).toBe('AAAA');
  });

  it('forwards nodeId to the plugin export', async () => {
    const dir = await makeDir();
    let forwarded: unknown = null;
    const dispatch: ToolDispatcher = async (_tool, args) => {
      forwarded = args;
      return { nodeId: '3:21', base64: 'AAAA' } satisfies PdfExport;
    };
    await handleExportPdf(dispatch, { nodeId: '3:21', outPath: join(dir, 'frame.pdf') });
    expect(forwarded).toEqual({ nodeId: '3:21' });
  });

  it('rejects input missing outPath', async () => {
    const dispatch: ToolDispatcher = async () =>
      ({ nodeId: '0:1', base64: null }) satisfies PdfExport;
    await expect(handleExportPdf(dispatch, {})).rejects.toThrow(/outPath/);
  });
});
