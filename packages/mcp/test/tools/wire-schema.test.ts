import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ErrorCode } from '@figwright/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleAnalyzeProject } from '../../src/tools/analyze-project.js';
import { handleComponentMap } from '../../src/tools/component-map.js';
import { handleDesignContext } from '../../src/tools/design-context-guard.js';
import { handleDesignDiff } from '../../src/tools/design-diff.js';
import { handleExportPdf } from '../../src/tools/export-pdf.js';
import { handleExportVideo } from '../../src/tools/export-video.js';
import { handleIconMap } from '../../src/tools/icon-map.js';
import { ALL_TOOL_SPECS } from '../../src/tools/registry.js';
import { handleSaveImageFills } from '../../src/tools/save-image-fills.js';
import { handleSaveScreenshots } from '../../src/tools/save-screenshots.js';
import { handleScanComponents } from '../../src/tools/scan-components.js';
import { handleTokenMap } from '../../src/tools/token-map.js';
import { checkBatchOps, WIRE_TOOL_SCHEMAS, wireToolSchema } from '../../src/tools/wire-schema.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'figwright-wire-schema-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }), 'utf8');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('wireToolSchema', () => {
  it('drops server-only fields and admits the ones the server injects', () => {
    // export_pdf is the tool that exercises both edits at once: `outPath` never leaves the server,
    // and `binary` appears in no schema because the agent never sends it.
    const schema = wireToolSchema(ALL_TOOL_SPECS.find(s => s.name === 'export_pdf')!)!;
    expect(schema.safeParse({ nodeId: '1:1', binary: true }).success).toBe(true);
    expect(Object.keys(schema.shape).toSorted()).toEqual(['binary', 'nodeId']);
  });

  it('admits the requestId a write carries without listing it on any spec', () => {
    const schema = wireToolSchema(ALL_TOOL_SPECS.find(s => s.name === 'rename_node')!)!;
    expect(schema.safeParse({ nodeId: '1:1', name: 'x', requestId: 'r-1' }).success).toBe(true);
    // …and not on a read, which never gets one.
    const read = wireToolSchema(ALL_TOOL_SPECS.find(s => s.name === 'get_selection')!)!;
    expect('requestId' in read.shape).toBe(false);
  });

  it('has no schema for a tool that borrows another tool’s sandbox handler', () => {
    // save_screenshots puts nothing on the wire under its own name — it dispatches get_screenshot,
    // and those arguments are validated there. Recording a schema for it would invent a handler.
    expect(wireToolSchema(ALL_TOOL_SPECS.find(s => s.name === 'save_screenshots')!)).toBeNull();
    expect(WIRE_TOOL_SCHEMAS.has('save_screenshots')).toBe(false);
    expect(WIRE_TOOL_SCHEMAS.has('get_screenshot')).toBe(true);
  });

  it('accepts a field it has never heard of rather than rejecting it', () => {
    // Load-bearing for mixed-version setups: the leader validating a call is not always the newest
    // build in the room, and a field added in a later release must not be rejected by an older
    // leader's narrower schema. Zod objects strip unknown keys instead of failing — which is also
    // why the leader forwards the *original* arguments and never the parsed output.
    const schema = WIRE_TOOL_SCHEMAS.get('rename_node')!;
    const parsed = schema.safeParse({ nodeId: '1:1', name: 'x', fieldFromTheFuture: 42 });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty('fieldFromTheFuture');
  });
});

/**
 * The arguments a server-side handler builds by hand, checked against the schema the leader will
 * validate them with.
 *
 * A `local` tool does not dispatch its own schema — it assembles a payload for some other tool's
 * sandbox handler (save_screenshots → get_screenshot, token_map → get_variable_defs + get_styles).
 * Nothing else compares the two: the tool's own schema is not the payload's shape, and the
 * plugin-contract gate reasons about argument _names_ rather than about a concrete call. So a
 * handler that assembled a payload the leader now refuses would break in production and stay green
 * here — which is precisely the failure this file exists to make impossible.
 *
 * Each case dispatches through a stub that records the payload and then aborts, so no case needs a
 * plugin, a Figma file, or a write to disk.
 */
const ABORT = 'wire-schema-probe-abort';

const capturingDispatch = (): {
  seen: { toolName: string; args: unknown }[];
  dispatch: (toolName: string, args: unknown) => Promise<never>;
} => {
  const seen: { toolName: string; args: unknown }[] = [];
  return {
    seen,
    dispatch: (toolName, args) => {
      seen.push({ toolName, args });
      return Promise.reject(new Error(ABORT));
    },
  };
};

describe('server-built plugin payloads satisfy the schema the leader validates', () => {
  const cases = (): {
    /** The tool whose handler assembles the payload — matched against the registry below. */
    tool: string;
    label: string;
    run: (dispatch: (toolName: string, args: unknown) => Promise<never>) => Promise<unknown>;
    expected: string[];
  }[] => [
    {
      tool: 'get_design_context',
      label: 'get_design_context (guarded public path)',
      run: d => handleDesignContext(d, { nodeId: '1:1' }),
      expected: ['get_design_context'],
    },
    {
      tool: 'get_design_context',
      label: 'get_design_context (no nodeId — the selection path)',
      run: d => handleDesignContext(d, {}),
      expected: ['get_design_context'],
    },
    {
      tool: 'component_map',
      label: 'component_map',
      run: d => handleComponentMap(d, { rootDir: root, nodeId: '1:1' }),
      expected: ['get_design_context'],
    },
    {
      tool: 'design_diff',
      label: 'design_diff',
      run: d => handleDesignDiff(d, { rootDir: root, nodeId: '1:1' }),
      expected: ['get_design_context'],
    },
    {
      tool: 'token_map',
      label: 'token_map',
      run: d => handleTokenMap(d, { rootDir: root }),
      expected: ['get_variable_defs', 'get_styles'],
    },
    {
      tool: 'save_screenshots',
      label: 'save_screenshots (defaults)',
      run: d => handleSaveScreenshots(d, { nodeIds: ['1:1'], outDir: root }),
      expected: ['get_screenshot'],
    },
    {
      tool: 'save_screenshots',
      label: 'save_screenshots (explicit format and scale)',
      run: d =>
        handleSaveScreenshots(d, { nodeIds: ['1:1'], outDir: root, format: 'JPG', scale: 2 }),
      expected: ['get_screenshot'],
    },
    {
      tool: 'save_image_fills',
      label: 'save_image_fills',
      run: d => handleSaveImageFills(d, { nodeIds: ['1:1'], outDir: root }),
      expected: ['save_image_fills'],
    },
    {
      tool: 'export_pdf',
      label: 'export_pdf (with nodeId)',
      run: d => handleExportPdf(d, { nodeId: '1:1', outPath: join(root, 'out.pdf') }),
      expected: ['export_pdf'],
    },
    {
      tool: 'export_pdf',
      label: 'export_pdf (current page)',
      run: d => handleExportPdf(d, { outPath: join(root, 'out.pdf') }),
      expected: ['export_pdf'],
    },
    {
      tool: 'export_video',
      label: 'export_video',
      run: d =>
        handleExportVideo(d, { nodeId: '1:1', format: 'MP4', outPath: join(root, 'out.mp4') }),
      expected: ['export_video'],
    },
    {
      tool: 'icon_map',
      label: 'icon_map',
      run: d => handleIconMap(d, { rootDir: root, nodeId: '1:1' }),
      expected: ['get_design_context'],
    },
  ];

  it.each(cases())('$label', async ({ run, expected }) => {
    const { seen, dispatch } = capturingDispatch();
    await run(dispatch).catch((err: unknown) => {
      // Anything other than the probe's own abort is a real failure, not an expected one.
      if (!(err instanceof Error) || err.message !== ABORT) throw err;
    });

    expect(seen.map(s => s.toolName)).toEqual(expected);
    for (const { toolName, args } of seen) {
      const schema = WIRE_TOOL_SCHEMAS.get(toolName);
      // The leader answers METHOD_NOT_FOUND for a name it has no schema for, so a server-built
      // dispatch to an unknown tool is as fatal as a malformed payload.
      expect(schema, `no wire schema for ${toolName}`).toBeDefined();
      const parsed = schema!.safeParse(args ?? {});
      expect(
        parsed.success ? null : `${toolName}: ${JSON.stringify(parsed.error?.issues)}`,
      ).toBeNull();

      // Stricter here than the leader can afford to be. A Zod object strips unknown keys rather
      // than rejecting them, which is what lets an older leader forward a field from a newer
      // release — so the runtime guard cannot tell a future field from a server-only one that
      // leaked into the payload. This test can: it runs against the build that produced the
      // payload, where any key outside the shape is unambiguously wrong.
      const allowed = new Set(Object.keys(schema!.shape));
      const stray = Object.keys((args ?? {}) as Record<string, unknown>).filter(
        key => !allowed.has(key),
      );
      expect(stray, `${toolName} payload carries keys the plugin has no argument for`).toEqual([]);
    }
  });

  it('covers every local tool that builds a plugin payload', async () => {
    // The case list is hand-written, so it needs the registry to hold it honest: a `local` spec is
    // one whose own schema is not what it dispatches, so each one either assembles a payload for
    // some other handler — and must appear above — or reaches no plugin at all.
    //
    // That second group is named rather than inferred, and then checked: a handler that dispatches
    // takes the dispatcher as its first parameter, so arity is the mechanical difference between
    // the two groups. Asserting it means the exemption cannot quietly start dispatching.
    const noDispatch: Record<string, (rawArgs: unknown) => Promise<unknown>> = {
      analyze_project: handleAnalyzeProject,
      scan_components: handleScanComponents,
    };
    for (const [name, handler] of Object.entries(noDispatch)) {
      expect(handler.length, `${name} takes a dispatcher — it belongs in the case list`).toBe(1);
    }

    const covered = new Set([...cases().map(c => c.tool), ...Object.keys(noDispatch)]);
    const uncovered = ALL_TOOL_SPECS.filter(
      spec => spec.kind === 'local' && !covered.has(spec.name),
    ).map(spec => spec.name);
    expect(uncovered).toEqual([]);
  });
});

describe('checkBatchOps', () => {
  const batch = (ops: unknown[]): unknown => ({ ops });

  it('passes a batch whose ops each match the schema of the tool they name', () => {
    expect(
      checkBatchOps(
        batch([
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'set_opacity', params: { nodeId: '1:1', opacity: 0.5 } },
          { tool: 'move_nodes', params: { nodeIds: ['1:2'], dx: 5, dy: -5 } },
        ]),
      ),
    ).toBeNull();
  });

  it('names the op index and its tool when arguments are missing', () => {
    // Which op is wrong is the whole answer here: a batch is one call, so "invalid arguments" with
    // no index leaves the caller to bisect thirty ops by hand.
    const rejection = checkBatchOps(
      batch([
        { tool: 'rename_node', params: { nodeId: '1:1', name: 'ok' } },
        { tool: 'set_fills', params: { nodeId: '1:1' } },
      ]),
    );
    expect(rejection?.code).toBe(ErrorCode.InvalidParams);
    expect(rejection?.message).toMatch(/ops\[1\]/);
    expect(rejection?.message).toMatch(/set_fills/);
    expect(rejection?.message).toMatch(/fills/);
  });

  it('catches an argument of the wrong type, which the sandbox would act on', () => {
    const rejection = checkBatchOps(
      batch([{ tool: 'set_opacity', params: { nodeId: '1:1', opacity: 'half' } }]),
    );
    expect(rejection?.code).toBe(ErrorCode.InvalidParams);
    expect(rejection?.message).toMatch(/opacity/);
  });

  it('refuses an op naming a tool no sandbox handler exists for', () => {
    for (const tool of ['not_a_tool', 'token_map']) {
      // token_map is a real tool — it just is not one the plugin serves, so an op naming it could
      // never have been applied either.
      const rejection = checkBatchOps(batch([{ tool, params: {} }]));
      expect(rejection?.code).toBe(ErrorCode.MethodNotFound);
      expect(rejection?.message).toMatch(new RegExp(tool));
    }
  });

  it('leaves "which tools may be batched" to the plugin', () => {
    // delete_nodes is a real, well-formed plugin tool that is deliberately not batchable (it cannot
    // be rolled back). The sandbox refuses it by name, with the reason; inventing a second copy of
    // that allowlist here is what this test exists to prevent.
    expect(
      checkBatchOps(batch([{ tool: 'delete_nodes', params: { nodeIds: ['1:1'] } }])),
    ).toBeNull();
  });

  it('treats an omitted params the way the sandbox does', () => {
    // parseOps substitutes `{}`, so an op with no params is a call with no arguments — fine for a
    // tool that needs none, and a missing-argument error for one that does.
    expect(checkBatchOps(batch([{ tool: 'create_frame' }]))).toBeNull();
    expect(checkBatchOps(batch([{ tool: 'rename_node' }]))?.code).toBe(ErrorCode.InvalidParams);
  });

  it('accepts a field it has never heard of, exactly as the top level does', () => {
    expect(
      checkBatchOps(
        batch([{ tool: 'rename_node', params: { nodeId: '1:1', name: 'x', fromTheFuture: 1 } }]),
      ),
    ).toBeNull();
  });

  it('says nothing about a shape the batch schema itself rejects', () => {
    // ops missing, not an array, or an op with no tool name: all rejected by batch's own schema
    // before this runs at either call site. Answering here too would just be a second opinion.
    expect(checkBatchOps({})).toBeNull();
    expect(checkBatchOps({ ops: 'nope' })).toBeNull();
    expect(checkBatchOps(batch([{ params: {} }]))).toBeNull();
  });
});
