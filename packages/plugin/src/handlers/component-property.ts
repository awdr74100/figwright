// Shared helpers for the component-property authoring writes (add / bind / edit / delete). Kept in
// one place so owner resolution and the type↔field mapping can't drift between the four handlers.

/**
 * The property types these tools author. VARIANT properties come from the variant-set structure
 * (combine_as_variants), and SLOT is out of scope — so authoring is BOOLEAN / TEXT / INSTANCE_SWAP,
 * the three that a plain component gains via addComponentProperty and that drive a sublayer field.
 */
export const PROPERTY_TYPES = ['BOOLEAN', 'TEXT', 'INSTANCE_SWAP'] as const;
export type AuthorablePropertyType = (typeof PROPERTY_TYPES)[number];

/** The node field (componentPropertyReferences key) each property type drives. */
export const FIELD_FOR_TYPE: Readonly<
  Record<AuthorablePropertyType, 'visible' | 'characters' | 'mainComponent'>
> = {
  BOOLEAN: 'visible',
  TEXT: 'characters',
  INSTANCE_SWAP: 'mainComponent',
};

/**
 * Resolve the node that owns component properties: a COMPONENT_SET as-is, a variant COMPONENT's
 * parent set (Figma keeps a variant's BOOLEAN/TEXT/SWAP props on the set so every variant shares
 * them), or a plain COMPONENT. Throws for an INSTANCE (author on the main component, not a copy) or
 * anything else. `tool` prefixes the error to match the calling tool.
 */
export const resolveComponentOwner = (
  tool: string,
  node: BaseNode,
): ComponentNode | ComponentSetNode => {
  if (node.type === 'COMPONENT_SET') return node;
  if (node.type === 'COMPONENT') {
    return node.parent !== null && node.parent.type === 'COMPONENT_SET' ? node.parent : node;
  }
  if (node.type === 'INSTANCE') {
    throw new Error(
      `${tool}: ${node.id} is an INSTANCE — author properties on its main component, not an instance`,
    );
  }
  throw new Error(`${tool}: ${node.id} (${node.type}) is not a component or component set`);
};

/**
 * Figma keeps shared BOOLEAN/TEXT/INSTANCE_SWAP properties on a variant's set and throws when a
 * variant's definitions are read.
 */
export const owningComponents = (node: BaseNode): (ComponentNode | ComponentSetNode)[] => {
  let cur: BaseNode | null = node;
  while (cur !== null) {
    if (cur.type === 'COMPONENT' || cur.type === 'COMPONENT_SET') break;
    cur = cur.parent;
  }
  if (cur === null) return [];
  if (cur.type === 'COMPONENT' && cur.parent !== null && cur.parent.type === 'COMPONENT_SET') {
    return [cur.parent];
  }
  return [cur];
};

/** Strip Figma's unique "#id" suffix off a property id to recover its display name. */
export const propertyDisplayName = (propertyId: string): string => {
  const hash = propertyId.lastIndexOf('#');
  return hash === -1 ? propertyId : propertyId.slice(0, hash);
};

/**
 * Figma's refusal of an INSTANCE_SWAP default, made actionable. That default is a **component's
 * node id**, and Figma's two refusals name neither the value nor the fix (both measured, for add
 * and edit alike, on local and library components):
 *
 * - A component key — and anything else not shaped like a node id — is "incompatible with component
 *   property type". The tools' own descriptions said "component key" until 0.8.0, so a key is the
 *   likeliest thing to be sent; a library component's key is refused too, its id being that of the
 *   copy imported into this file (an instance's mainComponent).
 * - A node id of anything but a component it can default to is "Default value … is invalid": an
 *   instance (what `"$N"` names after a create_instance op), a frame, a component set, a missing
 *   id, the component itself.
 *
 * Only ever rewrites an error Figma already raised, and only those two, recognised by the value for
 * the first (40 hex digits, which no node id is) and by Figma's words for the second — so no call
 * that succeeded before is refused, and an error this does not recognise passes through as raised.
 * Nothing is looked up: a missing id's lookup can wait on Figma's server, and this is a failure
 * path that answered in milliseconds.
 */
export const instanceSwapDefaultError = (
  tool: string,
  type: string | undefined,
  defaultValue: unknown,
  err: unknown,
): unknown => {
  if (type !== 'INSTANCE_SWAP' || typeof defaultValue !== 'string') return err;
  const message = err instanceof Error ? err.message : String(err);
  let hint: string;
  if (/^[0-9a-f]{40}$/i.test(defaultValue)) {
    hint =
      `defaultValue "${defaultValue}" is a component key; an INSTANCE_SWAP default takes the ` +
      'component\'s node id (e.g. "12:34") — get_local_components lists a local component\'s, and ' +
      "a library component's is the mainComponent id of an instance of it in this file (get_node; " +
      'create_instance with its componentKey adds one)';
  } else if (/default value for instance swap component property is invalid/i.test(message)) {
    hint =
      `defaultValue "${defaultValue}" is not a component this one can default to; it takes a ` +
      "COMPONENT's node id — not an instance (use its mainComponent id, from get_node), a frame, a " +
      'component set (name one of its variants) or the component itself';
  } else {
    return err;
  }
  return new Error(`${tool}: ${message} — ${hint}`, { cause: err });
};
