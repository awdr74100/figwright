import {
  type BatchRef,
  type BatchRefSite,
  findOpRefs,
  mapBatchRefSites,
  parseBatchRef,
  resolveBatchRef,
} from '@figwright/shared';

/**
 * The sandbox half of references between batch ops (`"$0"` — the rules are in shared's
 * batch-refs.ts). The shared half resolves every position that is an id by schema alone. This half
 * adds the places only the file can settle, all of them component properties:
 *
 * - A VARIANT property's id is its bare name, and a designer can call one anything, `$0` included. A
 *   `propertyId` of edit_component_property — and a key of set_instance_properties, which is a
 *   property id too — is therefore read as a reference only when the component has no property of
 *   that literal name, so a call naming a real property means what it always meant.
 * - A property value is an id only for an INSTANCE_SWAP property: the component to swap in (Figma
 *   takes its node id — measured; a component key is refused as "incompatible with component
 *   property type"). For TEXT the value is the text, where `"$5"` is a price. So a value of
 *   set_instance_properties, and a defaultValue of add_ / edit_component_property, is resolved only
 *   when the property it belongs to is INSTANCE_SWAP.
 */

interface Op {
  tool: string;
  params: unknown;
}

type Bag = Record<string, unknown>;

/** A reference to an op before this one, or null — anything else can only be literal. */
const earlierRef = (value: unknown, opIndex: number): BatchRef | null => {
  const ref = parseBatchRef(value);
  return ref !== null && ref.index < opIndex ? ref : null;
};

/** A key or value whose meaning depends on a property's type, and that could name an earlier op. */
const propertyCandidates = (op: Op, opIndex: number): boolean => {
  const params = op.params as Bag | null;
  switch (op.tool) {
    case 'set_instance_properties': {
      const properties = params?.properties;
      if (typeof properties !== 'object' || properties === null) return false;
      return Object.entries(properties).some(
        ([key, value]) => earlierRef(key, opIndex) !== null || earlierRef(value, opIndex) !== null,
      );
    }
    case 'add_component_property':
      return params?.type === 'INSTANCE_SWAP' && earlierRef(params.defaultValue, opIndex) !== null;
    case 'edit_component_property':
      return earlierRef(params?.defaultValue, opIndex) !== null;
    default:
      return false;
  }
};

/**
 * Does this op have to wait for earlier ops before it can even be captured? True when it carries a
 * reference — its target, or something its capture reads, does not exist until an earlier op runs.
 * Every other op is captured up front exactly as it always was.
 */
export const opNeedsEarlierResults = (op: Op, opIndex: number): boolean =>
  findOpRefs(op, opIndex).length > 0 || propertyCandidates(op, opIndex);

/**
 * The properties the op's component (or the component behind its instance) has right now — after
 * the earlier ops ran, so one an earlier add_component_property declared is among them — by name,
 * with each one's type.
 */
const propertyTypes = async (
  figmaCtx: typeof figma,
  op: Op,
  params: Bag,
): Promise<ReadonlyMap<string, string>> => {
  const lookup = async (id: unknown): Promise<BaseNode | null> =>
    typeof id === 'string' && parseBatchRef(id) === null ? figmaCtx.getNodeByIdAsync(id) : null;
  if (op.tool === 'edit_component_property') {
    const node = await lookup(params.componentId);
    if (node === null) return new Map();
    const owner =
      node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET' ? node.parent : node;
    if (owner.type !== 'COMPONENT' && owner.type !== 'COMPONENT_SET') return new Map();
    return new Map(
      Object.entries(owner.componentPropertyDefinitions).map(([name, def]) => [name, def.type]),
    );
  }
  if (op.tool === 'set_instance_properties') {
    const node = await lookup(params.instanceId);
    if (node?.type !== 'INSTANCE') return new Map();
    return new Map(
      Object.entries(node.componentProperties).map(([name, prop]) => [name, prop.type]),
    );
  }
  return new Map();
};

/**
 * One op's arguments with every reference replaced by what it names. Comes back as the same object
 * when there is nothing to resolve. Throws (naming the op, the position and what the earlier result
 * carries) when a reference names something its op did not produce.
 */
export const resolveOpRefs = async (
  figmaCtx: typeof figma,
  op: Op,
  opIndex: number,
  results: readonly unknown[],
  tools: readonly string[],
): Promise<unknown> => {
  const resolve = (site: BatchRefSite): string => {
    const ref = parseBatchRef(site.value);
    return ref === null ? site.value : resolveBatchRef(ref, site, opIndex, results, tools);
  };
  const toNode = (ref: BatchRef, path: string, value: string): string =>
    resolveBatchRef(ref, { path, field: 'nodeId', value }, opIndex, results, tools);

  // The property ids that may be references at all (shared findOpRefs: a component-property tool's,
  // naming an earlier op); any other `"$N"` there is a name and is passed on untouched.
  const propertyRefs = new Set(
    findOpRefs(op, opIndex)
      .filter(site => site.field === 'propertyId')
      .map(site => site.path),
  );
  // Every id-shaped position but the property ids, which need the component to tell a reference
  // from a variant name — and finding the component may itself need a resolved id.
  let resolved = mapBatchRefSites(op.params, site =>
    site.field === 'propertyId' ? site.value : resolve(site),
  );
  if (typeof resolved !== 'object' || resolved === null || Array.isArray(resolved)) {
    return resolved;
  }
  const types = await propertyTypes(figmaCtx, op, resolved as Bag);
  // A `"$N"` property id that is neither a property of the component nor one op N declared could
  // have been meant either way, so the error answers both — the shared one would offer op N's other
  // ids (`"$0.nodeId"`), none of which is a property id, and a call naming a property that is not
  // there was told "not found" before references existed.
  const resolveProperty = (site: BatchRefSite): string => {
    const ref = parseBatchRef(site.value);
    const result = ref === null ? undefined : (results[ref.index] as Bag | null | undefined);
    if (ref === null || ref.key !== undefined || typeof result?.propertyId === 'string') {
      return resolve(site);
    }
    throw new Error(
      `batch ops[${opIndex}]: ${site.path} is "${site.value}", which is not a property of the ` +
        'component (get_component_api lists the current ids), and op ' +
        `${ref.index} (${tools[ref.index] ?? '?'}) declared no property for it to refer to`,
    );
  };
  resolved = mapBatchRefSites(resolved, site =>
    site.field === 'propertyId' && propertyRefs.has(site.path) && !types.has(site.value)
      ? resolveProperty(site)
      : site.value,
  );
  let params = resolved as Bag;

  switch (op.tool) {
    case 'set_instance_properties':
      return resolveInstanceProperties(params, types, opIndex, results, tools);
    case 'add_component_property': {
      const ref = params.type === 'INSTANCE_SWAP' ? earlierRef(params.defaultValue, opIndex) : null;
      if (ref !== null) {
        params = {
          ...params,
          defaultValue: toNode(ref, 'params.defaultValue', params.defaultValue as string),
        };
      }
      return params;
    }
    case 'edit_component_property': {
      const ref = earlierRef(params.defaultValue, opIndex);
      const property = params.propertyId;
      if (ref !== null && typeof property === 'string' && types.get(property) === 'INSTANCE_SWAP') {
        params = {
          ...params,
          defaultValue: toNode(ref, 'params.defaultValue', params.defaultValue as string),
        };
      }
      return params;
    }
    default:
      return params;
  }
};

/** Where a set_instance_properties entry sits, for an error to name. */
const at = (key: string): string => `params.properties[${JSON.stringify(key)}]`;

const resolveInstanceProperties = (
  params: Bag,
  types: ReadonlyMap<string, string>,
  opIndex: number,
  results: readonly unknown[],
  tools: readonly string[],
): Bag => {
  const properties = params.properties;
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return params;
  }
  let changed = false;
  const out: Bag = {};
  for (const [key, value] of Object.entries(properties as Bag)) {
    let name = key;
    const keyRef = types.has(key) ? null : earlierRef(key, opIndex);
    if (keyRef !== null) {
      name = resolveBatchRef(
        keyRef,
        { path: `${at(key)} (key)`, field: 'propertyId', value: key },
        opIndex,
        results,
        tools,
      );
      // hasOwnProperty.call rather than Object.hasOwn: the sandbox's runtime support for the latter
      // has not been measured, and a property may well be called `constructor`.
      if (
        Object.prototype.hasOwnProperty.call(out, name) ||
        (name !== key && Object.prototype.hasOwnProperty.call(properties, name))
      ) {
        throw new Error(
          `batch ops[${opIndex}]: the key "${key}" names property "${name}", which this call ` +
            'already sets under its own name — set it once',
        );
      }
    }
    let next = value;
    const valueRef = earlierRef(value, opIndex);
    if (valueRef !== null && types.get(name) === 'INSTANCE_SWAP') {
      next = resolveBatchRef(
        valueRef,
        { path: at(key), field: 'nodeId', value: value as string },
        opIndex,
        results,
        tools,
      );
    }
    if (name !== key || next !== value) changed = true;
    out[name] = next;
  }
  return changed ? { ...params, properties: out } : params;
};
