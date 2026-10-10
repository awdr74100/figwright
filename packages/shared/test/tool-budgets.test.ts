import { describe, expect, it } from 'vitest';

import {
  BUDGET_LAYER_MARGIN_MS,
  DEFAULT_TOOL_BUDGET_MS,
  getFollowerBudget,
  getRelayBudget,
  getToolBudget,
  HEAVY_TOOL_BUDGET_MS,
} from '../src/tool-budgets.js';

describe('tool budgets', () => {
  it('gives unknown / light tools the default budget', () => {
    expect(getToolBudget('ping')).toBe(DEFAULT_TOOL_BUDGET_MS);
    expect(getToolBudget('set_fills')).toBe(DEFAULT_TOOL_BUDGET_MS);
    expect(getToolBudget('totally_unknown_tool')).toBe(DEFAULT_TOOL_BUDGET_MS);
  });

  it('gives heavy compute / big-payload tools the heavy budget', () => {
    for (const t of [
      'get_screenshot',
      'save_screenshots',
      'export_pdf',
      'get_document',
      'get_design_context',
      // Unbounded full-subtree serializations — at least as heavy as get_design_context on a large
      // frame, so they get the same window instead of the 30s default that beheaded big trees.
      'get_node',
      'get_nodes_info',
      // Page-wide walks: the result-size budget bounds how much is serialized, not how far the walk
      // goes to find the matches. search_nodes is the same walk as the scans (it once had the 30s
      // default and timed out at 35s on a 16k-instance page that scan_nodes_by_types finished).
      'search_nodes',
      'scan_nodes_by_types',
      'scan_text_nodes',
      'get_local_components',
      // Carries N writes and, on a failure, N undos — a timeout mid-rollback would hide whether the
      // document was left changed.
      'batch',
    ]) {
      expect(getToolBudget(t)).toBe(HEAVY_TOOL_BUDGET_MS);
    }
  });

  // The whole point of the table: the three nested timers must be strictly increasing outward, so the
  // innermost (sandbox) fires first with the most specific error and no layer is left orphaned.
  it('nests sandbox < relay < follower by one margin per layer', () => {
    for (const t of [
      'set_fills',
      'export_pdf',
      'search_nodes',
      'scan_nodes_by_types',
      'scan_text_nodes',
      'get_local_components',
    ]) {
      expect(getRelayBudget(t)).toBe(getToolBudget(t) + BUDGET_LAYER_MARGIN_MS);
      expect(getFollowerBudget(t)).toBe(getToolBudget(t) + 2 * BUDGET_LAYER_MARGIN_MS);
      expect(getToolBudget(t)).toBeLessThan(getRelayBudget(t));
      expect(getRelayBudget(t)).toBeLessThan(getFollowerBudget(t));
    }
  });
});
