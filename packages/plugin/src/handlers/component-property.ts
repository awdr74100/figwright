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
 * The components that could define a property referenced by `node` (a sublayer): the nearest
 * COMPONENT / COMPONENT_SET ancestor, plus that component's own COMPONENT_SET parent when it's a
 * variant — because a shared BOOLEAN/TEXT/SWAP prop lives on the set, not the variant. Empty when
 * the node isn't inside a component at all.
 */
export const owningComponents = (node: BaseNode): (ComponentNode | ComponentSetNode)[] => {
  let cur: BaseNode | null = node;
  while (cur !== null) {
    if (cur.type === 'COMPONENT' || cur.type === 'COMPONENT_SET') break;
    cur = cur.parent;
  }
  if (cur === null) return [];
  const owners: (ComponentNode | ComponentSetNode)[] = [cur];
  if (cur.type === 'COMPONENT' && cur.parent !== null && cur.parent.type === 'COMPONENT_SET') {
    owners.push(cur.parent);
  }
  return owners;
};

/** Strip Figma's unique "#id" suffix off a property id to recover its display name. */
export const propertyDisplayName = (propertyId: string): string => {
  const hash = propertyId.lastIndexOf('#');
  return hash === -1 ? propertyId : propertyId.slice(0, hash);
};
