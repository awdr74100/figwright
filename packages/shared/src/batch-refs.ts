// References between the ops of one `batch`.
//
// A batch op that creates something (a frame, a style, a variable, a mode, a component property)
// only learns the new id once it has run, and before this every op's arguments were fixed when the
// batch was sent — so a nested layout took one batch per level, each one atomic on its own and the
// whole build not atomic at all (a failure in the fifth left the first four applied, and every one
// of them was its own Cmd+Z step). A reference lets an op name what an earlier op in the same batch
// produced: `"$N"` is op N's id, `"$N.key"` is the string at `key` in op N's result.
//
// Where a reference is honoured is the whole design. A reference is only ever read in a position
// whose schema means "an id" — never in free text, where `"$5"` is a perfectly good label (a price)
// and must keep meaning exactly what it meant before. Those positions are recognised by shape, the
// same way `node-id.ts` recognises canvas-id fields, so a new tool picks them up without a table
// that could fall behind (and `test/batch-ref-sites.test.ts` pins the resulting set, so any change
// to it is a reviewed one):
//
// - a string under a key ending in `Id` (nodeId, parentId, styleId, variableId, modeId, propertyId,
//   destinationId, sourceNodeId, …) or the key `root`;
// - a string in an array under a key ending in `Ids` (nodeIds);
// - the `id` of a `{ type: 'VARIABLE_ALIAS', id }` object;
// - a value of a `boundVariables` map (`{ field: variableId }`).
//
// No real id of any kind starts with `$` (node ids are digits / `:` / `;` / `I`, style ids `S:…`,
// variable ids `VariableID:…`, component-property ids carry a `#` suffix), so in those positions the
// two readings cannot collide. The one id namespace a user names freely is a VARIANT property, whose
// id is its bare name — so a `propertyId` is a reference only where it could be one (findOpRefs),
// and the sandbox checks it against the component before reading it as one (plugin batch-refs.ts):
// a variant someone really called `$0` keeps working, wherever in the batch it is edited. The same
// file settles the values whose meaning depends on a property's type (an INSTANCE_SWAP value is a
// component id, a TEXT value is text).
//
// Resolution needs the earlier ops' results, which exist only in the sandbox as the batch applies,
// so the plugin resolves; the server only checks what can be checked before anything runs (a
// reference must name an earlier op) and refuses to send references to a plugin too old to resolve
// them, which would otherwise read `"$0"` as an id that does not exist — and for the tools that
// skip ids they cannot find (reparent / move / group / lock …), still answer `ok`.

/** A parsed reference: the op it names, and the result key it reads (default: by position). */
export interface BatchRef {
  index: number;
  key: string | undefined;
}

const REF = /^\$(0|[1-9]\d{0,5})(?:\.([A-Za-z][A-Za-z0-9]*))?$/;

/** `"$3"` → `{ index: 3 }`, `"$3.collectionId"` → `{ index: 3, key: 'collectionId' }`; else null. */
export const parseBatchRef = (value: unknown): BatchRef | null => {
  if (typeof value !== 'string') return null;
  const match = REF.exec(value);
  if (match === null) return null;
  return { index: Number(match[1]), key: match[2] };
};

/** Canvas-node positions: `"$N"` there reads the earlier op's `nodeId`. */
const NODE_FIELDS = new Set([
  'nodeId',
  'nodeIds',
  'parentId',
  'newParentId',
  'root',
  'instanceId',
  'fromNodeId',
  'sourceNodeId',
  'destinationId',
  // add_page answers with the page's `nodeId` — a page is a node.
  'pageId',
]);

/**
 * Which result keys a bare `"$N"` reads, in order, for the field it sits in. A field missing here
 * reads the result key of its own name, so a new `fooId` field reads an earlier op's `fooId`.
 *
 * - `componentId` — the node a create made, else the owner add_component_property answers with.
 * - `modeId` — a mode add_variable_mode made, else the default mode a new collection comes with.
 */
const RESULT_KEYS: Readonly<Record<string, readonly string[]>> = {
  componentId: ['nodeId', 'componentId'],
  modeId: ['modeId', 'defaultModeId'],
  variableModeId: ['modeId', 'defaultModeId'],
  variableCollectionId: ['collectionId'],
};

/** The result keys `"$N"` reads in `field`, first present wins. */
export const batchRefResultKeys = (field: string): readonly string[] => {
  if (NODE_FIELDS.has(field)) return ['nodeId'];
  const listed = RESULT_KEYS[field];
  if (listed !== undefined) return listed;
  if (field.endsWith('StyleId')) return ['styleId'];
  return [field];
};

/** One place a reference may sit. `field` names the id it stands for (see batchRefResultKeys). */
export interface BatchRefSite {
  path: string;
  field: string;
  value: string;
}

const isIdKey = (key: string): boolean => key.endsWith('Id') || key === 'root';
const isIdListKey = (key: string): boolean => key.endsWith('Ids');

/** `ops[3].params.fills[0].boundVariables.color` — what an error names. */
const join = (path: string, key: string | number): string =>
  typeof key === 'number'
    ? `${path}[${key}]`
    : /^[A-Za-z_$][\w$]*$/.test(key)
      ? `${path}.${key}`
      : `${path}[${JSON.stringify(key)}]`;

/**
 * Rebuild `value`, passing every string in a reference position through `map`. Copy-on-write:
 * anything `map` leaves alone comes back as the same object, so a call with nothing to resolve
 * hands the handler its own arguments untouched.
 */
export const mapBatchRefSites = (
  value: unknown,
  map: (site: BatchRefSite) => string,
  path = 'params',
): unknown => {
  const visit = (node: unknown, at: string, idField: string | null): unknown => {
    if (typeof node === 'string') {
      return idField === null ? node : map({ path: at, field: idField, value: node });
    }
    if (Array.isArray(node)) {
      let out: unknown[] | null = null;
      node.forEach((item, i) => {
        // Only a list under an `…Ids` key holds ids; an array elsewhere passes no field down.
        const next = visit(item, join(at, i), typeof item === 'string' ? idField : null);
        if (next !== item) (out ??= [...node])[i] = next;
      });
      return out ?? node;
    }
    if (typeof node !== 'object' || node === null) return node;
    const record = node as Record<string, unknown>;
    const alias = record.type === 'VARIABLE_ALIAS';
    let out: Record<string, unknown> | null = null;
    for (const [key, child] of Object.entries(record)) {
      let field: string | null = null;
      if (typeof child === 'string') {
        if (isIdKey(key)) field = key;
        else if (alias && key === 'id') field = 'variableId';
      } else if (Array.isArray(child) && isIdListKey(key)) {
        field = key;
      }
      const next =
        key === 'boundVariables' && typeof child === 'object' && child !== null
          ? visitBindings(child as Record<string, unknown>, join(at, key))
          : visit(child, join(at, key), field);
      if (next !== child) (out ??= { ...record })[key] = next;
    }
    return out ?? node;
  };
  // `{ field: variableId }` — every string value is a variable id, whatever its key.
  const visitBindings = (bindings: Record<string, unknown>, at: string): unknown => {
    if (Array.isArray(bindings)) return visit(bindings, at, null);
    let out: Record<string, unknown> | null = null;
    for (const [key, child] of Object.entries(bindings)) {
      const next = visit(child, join(at, key), typeof child === 'string' ? 'variableId' : null);
      if (next !== child) (out ??= { ...bindings })[key] = next;
    }
    return out ?? bindings;
  };
  return visit(value, path, null);
};

/** Every reference in one op's arguments, with where it sits. */
export const findBatchRefs = (params: unknown): (BatchRefSite & { ref: BatchRef })[] => {
  const found: (BatchRefSite & { ref: BatchRef })[] = [];
  mapBatchRefSites(params, site => {
    const ref = parseBatchRef(site.value);
    if (ref !== null) found.push({ ...site, ref });
    return site.value;
  });
  return found;
};

/**
 * The tools whose `propertyId` is a component property's — the one id a user names freely, since a
 * VARIANT property's id is its bare name. Elsewhere `propertyId` is a Motion keyframe field's id,
 * which no batch op produces.
 */
const COMPONENT_PROPERTY_TOOLS: ReadonlySet<string> = new Set([
  'edit_component_property',
  'bind_component_property',
  'delete_component_property',
]);

/**
 * The references among one op's arguments: every `"$N"` in an id position, except a `propertyId`
 * that cannot be one — and so means what it meant before references existed, a name.
 *
 * A `propertyId` is read as a reference only on a component-property tool, and only when it names
 * an earlier op; even then the sandbox reads it as a VARIANT's literal name first, when the
 * component has a property called that (plugin batch-refs.ts). Naming this op or a later one, it
 * can only be that literal name — a VARIANT called `$0` edited by the first op of a batch is a call
 * that worked before references, and must not now be refused as misordered (measured: it was, in
 * the first build of this). A Motion keyframe field's `propertyId` is never one: no op returns an
 * id it could take, so a `"$0"` there reaches Figma exactly as it always did.
 */
export const findOpRefs = (
  op: { tool?: unknown; params?: unknown },
  opIndex: number,
): (BatchRefSite & { ref: BatchRef })[] =>
  findBatchRefs(op.params).filter(
    site =>
      site.field !== 'propertyId' ||
      (typeof op.tool === 'string' &&
        COMPONENT_PROPERTY_TOOLS.has(op.tool) &&
        site.ref.index < opIndex),
  );

/**
 * What can be wrong with a batch's references before anything runs: one naming its own op or a
 * later one, whose result does not exist yet when it is needed. Null when every reference names an
 * earlier op. Both ends run it — the server so a bad batch never leaves, the sandbox because a call
 * can reach it without passing this server (an older leader forwards a newer follower's batch).
 */
export const batchRefOrderError = (
  ops: readonly { tool?: unknown; params?: unknown }[],
): string | null => {
  for (const [i, op] of ops.entries()) {
    for (const site of findOpRefs(op, i)) {
      if (site.ref.index >= i) {
        return (
          `batch ops[${i}]: ${site.path} is "${site.value}", which names op ${site.ref.index}` +
          `${site.ref.index === i ? ' (this op)' : ''} — a reference can only name an earlier op ` +
          'in the batch, whose result exists by the time this one runs'
        );
      }
    }
  }
  return null;
};

/**
 * True when a `batch` call carries a reference an older plugin would get silently wrong — what the
 * server will not send to one (relay.ts, dispatch.ts).
 *
 * A `propertyId` does not count. An older plugin reads one as the property's literal name, which is
 * exactly right for a VARIANT someone called `$0` (a call that worked before references, and still
 * has to); and where it was meant as a reference, every component-property handler since they
 * shipped (0.3.0) throws on a property it cannot find, so the batch fails whole and rolls back —
 * never the silent `ok` this guard exists to prevent.
 */
export const batchHasRefs = (args: unknown): boolean => {
  const ops = (args as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops)) return false;
  return ops.some((op, i) =>
    findOpRefs((op ?? {}) as { tool?: unknown; params?: unknown }, i).some(
      site => site.field !== 'propertyId',
    ),
  );
};

/** The string-valued keys of a result — what an error offers in place of a key that is missing. */
const idKeysOf = (result: unknown): string[] =>
  typeof result === 'object' && result !== null
    ? Object.entries(result)
        .filter(([key, v]) => typeof v === 'string' && key !== 'name' && key !== 'type')
        .map(([key]) => key)
    : [];

/**
 * The id a reference stands for, read from the earlier op's result. Throws, naming the op, the
 * position and what that result does carry, when it carries nothing the reference can stand for.
 */
export const resolveBatchRef = (
  ref: BatchRef,
  site: { path: string; field: string; value: string },
  opIndex: number,
  results: readonly unknown[],
  tools: readonly string[],
): string => {
  if (ref.index >= opIndex || ref.index >= results.length) {
    throw new Error(
      `batch ops[${opIndex}]: ${site.path} is "${site.value}", but op ${ref.index} has not run — ` +
        'a reference can only name an earlier op',
    );
  }
  const result = results[ref.index] as Record<string, unknown> | null;
  const keys = ref.key === undefined ? batchRefResultKeys(site.field) : [ref.key];
  for (const key of keys) {
    const id = result?.[key];
    if (typeof id === 'string') return id;
  }
  const offered = idKeysOf(result);
  throw new Error(
    `batch ops[${opIndex}]: ${site.path} is "${site.value}", but op ${ref.index} ` +
      `(${tools[ref.index] ?? '?'}) returned no ${keys.join(' / ')}` +
      (offered.length === 0
        ? ' — it returns no id to refer to'
        : ` — name one of its ids instead: ${offered.map(k => `"$${ref.index}.${k}"`).join(', ')}`),
  );
};

/**
 * One op's arguments with every reference replaced by the id it stands for. Comes back as the same
 * object when there is nothing to resolve.
 */
export const resolveBatchRefs = (
  params: unknown,
  opIndex: number,
  results: readonly unknown[],
  tools: readonly string[],
): unknown =>
  mapBatchRefSites(params, site => {
    const ref = parseBatchRef(site.value);
    return ref === null ? site.value : resolveBatchRef(ref, site, opIndex, results, tools);
  });
