import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ALL_TOOL_SPECS } from '../src/tools/registry.js';
import { toToolDefinition } from './tool-schema.js';

// Pins how Zod renders each construct the tool schemas are built from, against expectations written
// out by hand here rather than derived from Zod.
//
// The gap this closes: `e2e/mcp-wire.test.ts` checks the schema the SDK advertises against
// `test/tool-schema.ts`'s derivation, and both call the same `z.toJSONSchema`. That comparison
// catches an SDK that stops asking Zod the same question — but when Zod itself changes what it
// answers, both sides move together and the equality still holds. Nothing else looks: the registry
// test only asks whether a property declares some type, and the per-tool tests spell out a handful
// of properties among the hundreds advertised. A Zod release can therefore reshape what every
// client sees while all six gates stay green.
//
// Canaries, not a snapshot of all 112 schemas: the variable under test is Zod's rendering, not our
// tool list. Adding a tool must not touch this file — only a change in how Zod renders should. The
// coverage tests below are what keep that trade honest, by failing when a tool starts using a
// construct no canary pins.

/** The options `test/tool-schema.ts` passes, and through it what the SDK asks Zod for. */
const OPTIONS = { io: 'input', target: 'draft-2020-12' } as const;

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** Render a construct the way a tool's `inputSchema` would hold it: as one object property. */
const asProperty = (schema: z.ZodType): unknown => {
  const json = z.toJSONSchema(z.object({ value: schema }), OPTIONS) as {
    properties: Record<string, unknown>;
  };
  return json.properties.value;
};

/**
 * One construct, and the JSON Schema it must render to. The expectation is spelled out rather than
 * computed, so a change in Zod's output shows up here as a diff of literal JSON.
 */
interface Canary {
  what: string;
  schema: z.ZodType;
  json: unknown;
}

const CANARIES: Canary[] = [
  { what: 'string', schema: z.string(), json: { type: 'string' } },
  {
    what: 'described string',
    schema: z.string().describe('d'),
    json: { type: 'string', description: 'd' },
  },
  {
    what: 'string with a length bound',
    schema: z.string().min(1),
    json: { type: 'string', minLength: 1 },
  },
  { what: 'number', schema: z.number(), json: { type: 'number' } },
  {
    what: 'number with an inclusive floor',
    schema: z.number().min(0),
    json: { type: 'number', minimum: 0 },
  },
  {
    what: 'number with an inclusive ceiling',
    schema: z.number().max(1),
    json: { type: 'number', maximum: 1 },
  },
  {
    what: 'number with an exclusive floor',
    schema: z.number().gt(0),
    json: { type: 'number', exclusiveMinimum: 0 },
  },
  {
    // The bounds are the safe-integer range, which Zod attaches to the check itself.
    what: 'integer',
    schema: z.int(),
    json: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 },
  },
  { what: 'boolean', schema: z.boolean(), json: { type: 'boolean' } },
  { what: 'null', schema: z.null(), json: { type: 'null' } },
  { what: 'literal', schema: z.literal('LIT'), json: { type: 'string', const: 'LIT' } },
  { what: 'enum', schema: z.enum(['A', 'B']), json: { type: 'string', enum: ['A', 'B'] } },
  {
    what: 'array',
    schema: z.array(z.string()),
    json: { type: 'array', items: { type: 'string' } },
  },
  {
    what: 'array with a length bound',
    schema: z.array(z.string()).min(1),
    json: { minItems: 1, type: 'array', items: { type: 'string' } },
  },
  {
    // Every member carries a bare `type` and nothing else. The constrained union below is the same
    // construct with a check added, and the two are pinned separately because a renderer is free to
    // treat them differently.
    what: 'nullable scalar (union of bare types)',
    schema: z.string().nullable(),
    json: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  {
    what: 'union of two bare non-null types',
    schema: z.union([z.boolean(), z.string()]),
    json: { anyOf: [{ type: 'boolean' }, { type: 'string' }] },
  },
  {
    what: 'nullable with a check on the non-null member',
    schema: z.union([z.string().min(1), z.null()]),
    json: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
  },
  {
    what: 'record',
    schema: z.record(z.string(), z.string()),
    json: {
      type: 'object',
      propertyNames: { type: 'string' },
      additionalProperties: { type: 'string' },
    },
  },
  {
    what: 'record of unknown',
    schema: z.record(z.string(), z.unknown()),
    json: { type: 'object', propertyNames: { type: 'string' }, additionalProperties: {} },
  },
  {
    what: 'nested object',
    schema: z.object({ inner: z.string() }),
    json: { type: 'object', properties: { inner: { type: 'string' } }, required: ['inner'] },
  },
  {
    what: 'discriminated union',
    schema: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), x: z.number() }),
      z.object({ kind: z.literal('b'), y: z.string() }),
    ]),
    json: {
      oneOf: [
        {
          type: 'object',
          properties: { kind: { type: 'string', const: 'a' }, x: { type: 'number' } },
          required: ['kind', 'x'],
        },
        {
          type: 'object',
          properties: { kind: { type: 'string', const: 'b' }, y: { type: 'string' } },
          required: ['kind', 'y'],
        },
      ],
    },
  },
];

/**
 * Whole-schema renderings, which the per-property canaries above cannot see: the dialect stamp, how
 * optionality becomes `required`, and that a closed object stays silent on `additionalProperties`
 * where a loose one opens it.
 */
const ENVELOPES: Canary[] = [
  {
    what: 'object with a required and an optional property',
    schema: z.object({ a: z.string(), b: z.number().optional() }),
    json: {
      $schema: DIALECT,
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
    },
  },
  {
    what: 'object taking no arguments',
    schema: z.object({}),
    json: { $schema: DIALECT, type: 'object', properties: {} },
  },
  {
    what: 'loose object',
    schema: z.looseObject({ a: z.string() }),
    json: {
      $schema: DIALECT,
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: {},
    },
  },
];

/** Every JSON Schema keyword appearing anywhere in a rendered schema. */
const keywordsIn = (node: unknown, out: Set<string>): Set<string> => {
  if (Array.isArray(node)) {
    for (const item of node) keywordsIn(item, out);
    return out;
  }
  if (typeof node !== 'object' || node === null) return out;
  for (const [key, value] of Object.entries(node)) {
    out.add(key);
    // `enum` and `required` hold plain values, not subschemas; descending would add their contents
    // as keywords. Everything else can nest — `properties` maps names to subschemas, and a name is
    // not a keyword, so it is the values that are walked.
    if (key === 'enum' || key === 'required') continue;
    if (key === 'properties' || key === '$defs') {
      for (const sub of Object.values(value as Record<string, unknown>)) keywordsIn(sub, out);
    } else keywordsIn(value, out);
  }
  return out;
};

/** Every value the `type` keyword takes, flattened across the array form. */
const typeValuesIn = (node: unknown, out: Set<string>): Set<string> => {
  if (Array.isArray(node)) {
    for (const item of node) typeValuesIn(item, out);
    return out;
  }
  if (typeof node !== 'object' || node === null) return out;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type') {
      for (const t of Array.isArray(value) ? value : [value]) {
        if (typeof t === 'string') out.add(t);
      }
      continue;
    }
    if (key === 'enum' || key === 'required') continue;
    if (key === 'properties' || key === '$defs') {
      for (const sub of Object.values(value as Record<string, unknown>)) typeValuesIn(sub, out);
    } else typeValuesIn(value, out);
  }
  return out;
};

const advertised = ALL_TOOL_SPECS.map(spec => toToolDefinition(spec).inputSchema);

const pinned = [
  ...CANARIES.map(c => asProperty(c.schema)),
  ...ENVELOPES.map(e => z.toJSONSchema(e.schema, OPTIONS)),
];

describe('JSON Schema generation', () => {
  it.each(CANARIES)('renders $what', ({ schema, json }) => {
    expect(asProperty(schema)).toEqual(json);
  });

  it.each(ENVELOPES)('renders $what', ({ schema, json }) => {
    expect(z.toJSONSchema(schema, OPTIONS)).toEqual(json);
  });

  // The canaries above are only worth their maintenance if they cover what the tools actually use.
  // Deriving the requirement from ALL_TOOL_SPECS is what keeps this from rotting into a list of
  // constructs that used to matter: a tool reaching for something new fails here until a canary
  // pins how that something renders.
  it('pins every JSON Schema keyword the advertised tools rely on', () => {
    const used = new Set<string>();
    for (const schema of advertised) keywordsIn(schema, used);
    const covered = new Set<string>();
    for (const schema of pinned) keywordsIn(schema, covered);

    expect([...used].filter(k => !covered.has(k)).toSorted()).toEqual([]);
  });

  it('pins every `type` value the advertised tools rely on', () => {
    const used = new Set<string>();
    for (const schema of advertised) typeValuesIn(schema, used);
    const covered = new Set<string>();
    for (const schema of pinned) typeValuesIn(schema, covered);

    expect([...used].filter(t => !covered.has(t)).toSorted()).toEqual([]);
  });
});
