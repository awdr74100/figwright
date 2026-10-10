import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GetDesignContextResultSchema } from '@figwright/shared';
import { expect, it } from 'vitest';
import { z } from 'zod';

import { SNAPSHOT_FORMAT_VERSION } from '../src/tools/design-diff.js';

// design_diff compares a saved get_design_context against a fresh one field by field, so a field
// the baseline predates reads as "changed" on every node that has it — a design edit nobody made,
// and an agent told to update the code for it. The format version is what prevents that: a baseline
// of another version is re-captured instead of diffed. Nothing tied it to the shape it versions, and
// eight fields went in after v2 without a bump. This records the shape next to the version, so a
// change to either is a visible decision: bump the version (a field a baseline could lack), or —
// only when the change can never show up as a diff — re-record as is.

const RECORD_PATH = join(dirname(fileURLToPath(import.meta.url)), 'design-diff-format.json');
const RERECORD = 'UPDATE_DESIGN_DIFF_FORMAT=1 pnpm test design-diff-format && pnpm format';

interface JsonNode {
  $ref?: string;
  $defs?: Record<string, JsonNode>;
  properties?: Record<string, JsonNode>;
  items?: JsonNode;
  additionalProperties?: JsonNode | boolean;
  anyOf?: JsonNode[];
  oneOf?: JsonNode[];
  allOf?: JsonNode[];
}

/**
 * Every property path of a result schema, each shared definition walked once. A definition is
 * labelled by the path it is first reached at (`nodes[]`), never by its key in `$defs`: that key is
 * Zod's internal name (`__schema0`), and a Zod release that renamed it would otherwise report every
 * node field as changed — and the report would advise a version bump that throws away every user's
 * baseline for a shape that did not move.
 */
const fieldsOf = (json: JsonNode): string[] => {
  const defs = json.$defs ?? {};
  const fields = new Set<string>();
  const visited = new Set<string>();
  const walk = (node: JsonNode | boolean | undefined, path: string): void => {
    if (typeof node !== 'object') return;
    if (node.$ref !== undefined) {
      const name = node.$ref.split('/').at(-1)!;
      if (visited.has(name)) return;
      visited.add(name);
      walk(defs[name], path);
      return;
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      const at = path === '' ? key : `${path}.${key}`;
      fields.add(at);
      walk(child, at);
    }
    walk(node.items, `${path}[]`);
    walk(node.additionalProperties, `${path}{}`);
    for (const branch of [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]) {
      walk(branch, path);
    }
  };
  walk(json, '');
  return [...fields].toSorted();
};

const resultSchema = (): JsonNode =>
  z.toJSONSchema(GetDesignContextResultSchema, {
    unrepresentable: 'any',
    io: 'output',
  }) as JsonNode;

const capturedFields = (): string[] => fieldsOf(resultSchema());

interface Recorded {
  version: number;
  fields: string[];
}

const current: Recorded = { version: SNAPSHOT_FORMAT_VERSION, fields: capturedFields() };

if (process.env.UPDATE_DESIGN_DIFF_FORMAT === '1') {
  writeFileSync(RECORD_PATH, `${JSON.stringify(current, null, 2)}\n`);
}
if (!existsSync(RECORD_PATH)) {
  throw new Error(`${RECORD_PATH} is missing — it is committed; restore it, or: ${RERECORD}`);
}
const recorded = JSON.parse(readFileSync(RECORD_PATH, 'utf8')) as Recorded;

it('walks the real result shape', () => {
  // A walk that silently found nothing would pass forever; these are long-standing fields.
  expect(current.fields).toEqual(
    expect.arrayContaining(['nodes', 'globalVars', 'nodes[].id', 'nodes[].children']),
  );
});

it("does not depend on Zod's names for its definitions", () => {
  // Rename every definition the way a Zod release might, and point every $ref at the new name.
  const json = resultSchema();
  const renamed = JSON.parse(
    JSON.stringify(json).replaceAll(
      /"(#\/\$defs\/)?(__schema\d+)"/g,
      (_m, ref: string | undefined, name: string) => `"${ref ?? ''}renamed_${name}"`,
    ),
  ) as JsonNode;
  expect(Object.keys(renamed.$defs ?? {})).not.toEqual(Object.keys(json.$defs ?? {}));
  expect(fieldsOf(renamed)).toEqual(fieldsOf(json));
});

it('versions every change to what a baseline captures', () => {
  const added = current.fields.filter(f => !recorded.fields.includes(f));
  const removed = recorded.fields.filter(f => !current.fields.includes(f));
  const report =
    added.length === 0 && removed.length === 0 && recorded.version === current.version
      ? ''
      : [
          'The shape design_diff saves as a baseline changed. Decide, then re-record:',
          ...added.map(f => `  + ${f}`),
          ...removed.map(f => `  - ${f}`),
          `  Recorded version: ${recorded.version}   SNAPSHOT_FORMAT_VERSION: ${current.version}`,
          '  A baseline without an added field reports it as a change on every node that has it:',
          '  bump SNAPSHOT_FORMAT_VERSION in src/tools/design-diff.ts so older baselines are',
          '  re-captured. Re-record without a bump only if the change can never appear in a diff.',
          `  Re-record with: ${RERECORD}`,
        ].join('\n');
  expect(report).toBe('');
});
