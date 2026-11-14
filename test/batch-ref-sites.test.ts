import { describe, expect, it } from 'vitest';

import { ALL_TOOL_SPECS } from '../packages/mcp/src/tools/registry.js';
import { toToolDefinition } from '../packages/mcp/test/tool-schema.js';
import { BATCHABLE_TOOLS } from '../packages/plugin/src/handlers/batch.js';
import { findBatchRefs } from '../packages/shared/src/index.js';

// Where a batch op may refer to an earlier op's result (`"$0"`) is decided by shape (shared's
// batch-refs.ts), not by a list — so a new tool, or a new field on one, can start or stop accepting
// references without anyone writing it down. This walks every batchable tool's advertised schema,
// puts `"$0"` in each string position in turn, and asks the real `findBatchRefs` whether it would be
// read as a reference. The answer is pinned below: any change to it fails here, so it is a reviewed
// change and never a side effect.
//
// The half that matters most is the other direction — a position that is NOT listed is one where
// `"$0"` stays literal text. A text field reading as a reference would turn a label of "$5" into an
// id lookup, which is exactly the regression this design exists to rule out.

interface Leaf {
  /** Readable path, `{*}` for a record entry and `[]` for an array item. */
  path: string;
  /** The leaf's own string schema — a constraint here could refuse "$0" where a real id passes. */
  schema: Schema;
  /** How to put a value there: object keys, `0` for an array index. */
  steps: (string | 0)[];
  /** Objects on the way that need `type: 'VARIABLE_ALIAS'` beside the leaf. */
  aliasAt: number[];
}

type Schema = Record<string, unknown>;

const leaves = (schema: Schema): Leaf[] => {
  const out: Leaf[] = [];
  const walk = (s: Schema | undefined, path: string, steps: (string | 0)[], aliasAt: number[]) => {
    if (s === undefined || typeof s !== 'object') return;
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      const members = s[key];
      if (Array.isArray(members)) for (const m of members) walk(m as Schema, path, steps, aliasAt);
    }
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (types.includes('string') && s.const === undefined && s.enum === undefined) {
      out.push({ path, steps, aliasAt, schema: s });
    }
    const props = s.properties as Record<string, Schema> | undefined;
    if (props !== undefined) {
      const isAlias = (props.type as Schema | undefined)?.const === 'VARIABLE_ALIAS';
      for (const [k, v] of Object.entries(props)) {
        walk(v, `${path}.${k}`, [...steps, k], isAlias ? [...aliasAt, steps.length] : aliasAt);
      }
    }
    if (typeof s.additionalProperties === 'object') {
      walk(s.additionalProperties as Schema, `${path}{*}`, [...steps, 'k'], aliasAt);
    }
    if (typeof s.items === 'object') walk(s.items as Schema, `${path}[]`, [...steps, 0], aliasAt);
  };
  walk(schema, '', [], []);
  return out;
};

/** A minimal argument object with `value` at the leaf (and the alias tag where one belongs). */
const place = (leaf: Leaf, value: string): unknown => {
  const root: Record<string, unknown> = {};
  let node: Record<string, unknown> | unknown[] = root;
  leaf.steps.forEach((step, i) => {
    if (leaf.aliasAt.includes(i)) (node as Record<string, unknown>).type = 'VARIABLE_ALIAS';
    const last = i === leaf.steps.length - 1;
    const next: unknown = last ? value : typeof leaf.steps[i + 1] === 'number' ? [] : {};
    if (Array.isArray(node)) node[0] = next;
    else node[step as string] = next;
    if (!last) node = next as Record<string, unknown> | unknown[];
  });
  if (leaf.aliasAt.includes(leaf.steps.length)) root.type = 'VARIABLE_ALIAS';
  return root;
};

const refSites = (): string[] => {
  const sites = new Set<string>();
  for (const spec of ALL_TOOL_SPECS) {
    if (!BATCHABLE_TOOLS.includes(spec.name)) continue;
    const { inputSchema } = toToolDefinition(spec) as { inputSchema: Schema };
    for (const leaf of leaves(inputSchema)) {
      const found = findBatchRefs(place(leaf, '$0'));
      // One leaf, one value: more than one site would mean a position is counted twice.
      if (found.length > 1) sites.add(`${spec.name}${leaf.path} → FOUND ${found.length} TIMES`);
      if (found[0] !== undefined) sites.add(`${spec.name}${leaf.path} → ${found[0].field}`);
      // The server validates every op against its tool's schema before anything is sent, so a
      // pattern, format or length bound on an id would refuse "$0" there while a real id passed.
      if (found[0] !== undefined) {
        const bounds = ['pattern', 'format', 'minLength', 'maxLength'].filter(
          k => k in leaf.schema,
        );
        if (bounds.length > 0) sites.add(`${spec.name}${leaf.path} → CONSTRAINED BY ${bounds}`);
      }
    }
  }
  return [...sites].toSorted();
};

describe('batch reference positions', () => {
  it('are exactly the id positions of every batchable tool (a change here is a reviewed one)', () => {
    expect(refSites()).toEqual(EXPECTED);
  });

  it('never include a text field', () => {
    // The fields whose value is the text a user sees, or a name they typed — a sample from the
    // tools an agent builds with most. Nothing in EXPECTED may be one of them.
    const text = [
      'create_text.characters',
      'set_text.characters',
      'set_text_range.ranges[].characters',
      'create_frame.name',
      'rename_node.name',
      'find_replace_text.find',
      'find_replace_text.replace',
      'set_instance_properties.properties{*}',
      'add_component_property.name',
      'add_component_property.defaultValue',
      'set_variable_value.value',
      'set_variable_code_syntax.codeSyntax.WEB',
      'create_variable.name',
      'create_paint_style.description',
    ];
    const listed = new Set(EXPECTED.map(s => s.split(' → ')[0]));
    expect(text.filter(t => listed.has(t))).toEqual([]);
  });
});

const EXPECTED: string[] = [
  'add_component_property.componentId → componentId',
  'add_variable_mode.collectionId → collectionId',
  'align_nodes.nodeIds[] → nodeIds',
  'apply_animation_style.config.props{*}.id → variableId',
  'apply_animation_style.nodeId → nodeId',
  'apply_animation_style.styleId → styleId',
  'apply_manual_keyframe_track.field.propertyId → propertyId',
  'apply_manual_keyframe_track.nodeId → nodeId',
  'apply_manual_keyframe_track.track.keyframes[].easing.id → variableId',
  'apply_style_to_node.nodeId → nodeId',
  'apply_style_to_node.styleId → styleId',
  'batch_rename_nodes.renames[].nodeId → nodeId',
  'bind_component_property.nodeId → nodeId',
  'bind_component_property.propertyId → propertyId',
  'bind_variable_to_node.nodeId → nodeId',
  'bind_variable_to_node.variableId → variableId',
  'bind_variable_to_paint.nodeId → nodeId',
  'bind_variable_to_paint.variableId → variableId',
  'clone_node.nodeId → nodeId',
  'combine_as_variants.nodeIds[] → nodeIds',
  'combine_as_variants.parentId → parentId',
  'create_component.fromNodeId → fromNodeId',
  'create_component.parentId → parentId',
  'create_effect_style.effects[].boundVariables{*} → variableId',
  'create_ellipse.fills[].boundVariables{*} → variableId',
  'create_ellipse.fills[].gradientStops[].boundVariables{*} → variableId',
  'create_ellipse.fills[].sourceNodeId → sourceNodeId',
  'create_ellipse.parentId → parentId',
  'create_ellipse.strokes[].boundVariables{*} → variableId',
  'create_ellipse.strokes[].gradientStops[].boundVariables{*} → variableId',
  'create_ellipse.strokes[].sourceNodeId → sourceNodeId',
  'create_frame.fills[].boundVariables{*} → variableId',
  'create_frame.fills[].gradientStops[].boundVariables{*} → variableId',
  'create_frame.fills[].sourceNodeId → sourceNodeId',
  'create_frame.parentId → parentId',
  'create_frame.strokes[].boundVariables{*} → variableId',
  'create_frame.strokes[].gradientStops[].boundVariables{*} → variableId',
  'create_frame.strokes[].sourceNodeId → sourceNodeId',
  'create_grid_style.grids[].boundVariables{*} → variableId',
  'create_instance.componentId → componentId',
  'create_instance.parentId → parentId',
  'create_paint_style.paints[].boundVariables{*} → variableId',
  'create_paint_style.paints[].gradientStops[].boundVariables{*} → variableId',
  'create_rectangle.fills[].boundVariables{*} → variableId',
  'create_rectangle.fills[].gradientStops[].boundVariables{*} → variableId',
  'create_rectangle.fills[].sourceNodeId → sourceNodeId',
  'create_rectangle.parentId → parentId',
  'create_rectangle.strokes[].boundVariables{*} → variableId',
  'create_rectangle.strokes[].gradientStops[].boundVariables{*} → variableId',
  'create_rectangle.strokes[].sourceNodeId → sourceNodeId',
  'create_section.parentId → parentId',
  'create_shape.fills[].boundVariables{*} → variableId',
  'create_shape.fills[].gradientStops[].boundVariables{*} → variableId',
  'create_shape.fills[].sourceNodeId → sourceNodeId',
  'create_shape.parentId → parentId',
  'create_shape.strokes[].boundVariables{*} → variableId',
  'create_shape.strokes[].gradientStops[].boundVariables{*} → variableId',
  'create_shape.strokes[].sourceNodeId → sourceNodeId',
  'create_text.fills[].boundVariables{*} → variableId',
  'create_text.fills[].gradientStops[].boundVariables{*} → variableId',
  'create_text.fills[].sourceNodeId → sourceNodeId',
  'create_text.parentId → parentId',
  'create_text_style.boundVariables{*} → variableId',
  'create_variable.collectionId → collectionId',
  'create_vector.fills[].boundVariables{*} → variableId',
  'create_vector.fills[].gradientStops[].boundVariables{*} → variableId',
  'create_vector.fills[].sourceNodeId → sourceNodeId',
  'create_vector.parentId → parentId',
  'create_vector.strokes[].boundVariables{*} → variableId',
  'create_vector.strokes[].gradientStops[].boundVariables{*} → variableId',
  'create_vector.strokes[].sourceNodeId → sourceNodeId',
  'create_vector.vectorNetwork.regions[].fills[].boundVariables{*} → variableId',
  'create_vector.vectorNetwork.regions[].fills[].gradientStops[].boundVariables{*} → variableId',
  'edit_component_property.componentId → componentId',
  'edit_component_property.propertyId → propertyId',
  'find_replace_text.root → root',
  'flip_nodes.nodeIds[] → nodeIds',
  'group_nodes.nodeIds[] → nodeIds',
  'import_image.parentId → parentId',
  'import_svg.parentId → parentId',
  'lock_nodes.nodeIds[] → nodeIds',
  'move_nodes.nodeIds[] → nodeIds',
  'navigate_to_page.pageId → pageId',
  'outline_stroke.nodeId → nodeId',
  'remove_reactions.nodeId → nodeId',
  'rename_node.nodeId → nodeId',
  'rename_page.pageId → pageId',
  'rename_variable.variableId → variableId',
  'reorder_nodes.nodeIds[] → nodeIds',
  'reparent_nodes.newParentId → newParentId',
  'reparent_nodes.nodeIds[] → nodeIds',
  'repeat_nodes.nodeIds[] → nodeIds',
  'resize_nodes.nodeIds[] → nodeIds',
  'rotate_nodes.nodeIds[] → nodeIds',
  'set_arc.nodeId → nodeId',
  'set_auto_layout.nodeId → nodeId',
  'set_blend_mode.nodeId → nodeId',
  'set_complex_stroke.nodeId → nodeId',
  'set_constraints.nodeId → nodeId',
  'set_corner_radius.nodeId → nodeId',
  'set_effects.effects[].boundVariables{*} → variableId',
  'set_effects.nodeId → nodeId',
  'set_fills.fills[].boundVariables{*} → variableId',
  'set_fills.fills[].gradientStops[].boundVariables{*} → variableId',
  'set_fills.fills[].sourceNodeId → sourceNodeId',
  'set_fills.nodeId → nodeId',
  'set_image_fill.nodeId → nodeId',
  'set_instance_properties.instanceId → instanceId',
  'set_instance_properties.properties{*}.id → variableId',
  'set_layout_grids.grids[].boundVariables{*} → variableId',
  'set_layout_grids.nodeId → nodeId',
  'set_layout_props.nodeId → nodeId',
  'set_mask.nodeId → nodeId',
  'set_node_variable_mode.collectionId → collectionId',
  'set_node_variable_mode.modeId → modeId',
  'set_node_variable_mode.nodeId → nodeId',
  'set_opacity.nodeId → nodeId',
  'set_position.nodeId → nodeId',
  'set_reactions.nodeId → nodeId',
  'set_reactions.reactions[].actions[].destinationId → destinationId',
  'set_reactions.reactions[].actions[].variableCollectionId → variableCollectionId',
  'set_reactions.reactions[].actions[].variableId → variableId',
  'set_reactions.reactions[].actions[].variableModeId → variableModeId',
  'set_repeat.nodeId → nodeId',
  'set_strokes.nodeId → nodeId',
  'set_strokes.strokes[].boundVariables{*} → variableId',
  'set_strokes.strokes[].gradientStops[].boundVariables{*} → variableId',
  'set_strokes.strokes[].sourceNodeId → sourceNodeId',
  'set_text.nodeId → nodeId',
  'set_text_path.nodeId → nodeId',
  'set_text_properties.nodeId → nodeId',
  'set_text_range.nodeId → nodeId',
  'set_text_range.ranges[].boundVariables{*} → variableId',
  'set_text_range.ranges[].fillStyleId → fillStyleId',
  'set_text_range.ranges[].fills[].boundVariables{*} → variableId',
  'set_text_range.ranges[].fills[].gradientStops[].boundVariables{*} → variableId',
  'set_text_range.ranges[].textStyleId → textStyleId',
  'set_timeline_duration.nodeId → nodeId',
  'set_timeline_duration.timelineId → timelineId',
  'set_variable_code_syntax.variableId → variableId',
  'set_variable_value.modeId → modeId',
  'set_variable_value.value.color.id → variableId',
  'set_variable_value.value.id → variableId',
  'set_variable_value.value.opacity.id → variableId',
  'set_variable_value.variableId → variableId',
  'set_vector.nodeId → nodeId',
  'set_vector.vectorNetwork.regions[].fills[].boundVariables{*} → variableId',
  'set_vector.vectorNetwork.regions[].fills[].gradientStops[].boundVariables{*} → variableId',
  'set_visible.nodeId → nodeId',
  'swap_component.componentId → componentId',
  'swap_component.instanceId → instanceId',
  'unlock_nodes.nodeIds[] → nodeIds',
  'update_effect_style.effects[].boundVariables{*} → variableId',
  'update_effect_style.styleId → styleId',
  'update_flows.flows[].nodeId → nodeId',
  'update_flows.pageId → pageId',
  'update_paint_style.paints[].boundVariables{*} → variableId',
  'update_paint_style.paints[].gradientStops[].boundVariables{*} → variableId',
  'update_paint_style.styleId → styleId',
  'update_text_style.boundVariables{*} → variableId',
  'update_text_style.styleId → styleId',
  'update_variable_collection.collectionId → collectionId',
  'update_variable_collection.modes[].modeId → modeId',
];
