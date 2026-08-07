import { describe, expect, it } from 'vitest';

import {
  checkPluginCompatibility,
  compareVersions,
  MIN_PLUGIN_VERSION,
  pluginSkewNotice,
  requiredPluginVersion,
} from '../src/version.js';

describe('compareVersions', () => {
  it('orders by numeric core, not lexically', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.4.0', '0.4.0')).toBe(0);
    expect(compareVersions('0.4.1', '0.4.0')).toBeGreaterThan(0);
  });

  it('ranks a prerelease below the release it leads to', () => {
    // Matters for the floor: a 0.4.0-beta.1 plugin must not satisfy a 0.4.0 requirement, because
    // the argument that moved the floor may have landed after that beta was cut.
    expect(compareVersions('0.4.0-beta.1', '0.4.0')).toBeLessThan(0);
    expect(compareVersions('0.4.0', '0.4.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('0.4.0-beta.2', '0.4.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('0.4.0-alpha', '0.4.0-beta')).toBeLessThan(0);
    expect(compareVersions('0.4.0-beta', '0.4.0-beta.1')).toBeLessThan(0);
  });

  it('ignores build metadata', () => {
    expect(compareVersions('0.4.0+abc', '0.4.0')).toBe(0);
  });

  it('reports null for anything this product could not have produced', () => {
    expect(compareVersions('0.4', '0.4.0')).toBeNull();
    expect(compareVersions('', '0.4.0')).toBeNull();
    expect(compareVersions('latest', '0.4.0')).toBeNull();
    expect(compareVersions('v0.4.0', '0.4.0')).toBeNull();
  });
});

describe('requiredPluginVersion', () => {
  it('is the floor once the server has caught up to it', () => {
    expect(requiredPluginVersion('0.4.0')).toBe(MIN_PLUGIN_VERSION);
    expect(requiredPluginVersion('9.9.9')).toBe(MIN_PLUGIN_VERSION);
  });

  it('never exceeds the server itself', () => {
    // The window this exists for: the floor is raised in the change that breaks compatibility, which
    // is always ahead of the release carrying it. Both halves built from that tree report the older
    // version, and a server that demanded a plugin newer than itself would reject its own build.
    expect(requiredPluginVersion('0.3.0')).toBe('0.3.0');
    expect(requiredPluginVersion('0.1.0')).toBe('0.1.0');
  });
});

describe('pluginSkewNotice', () => {
  it('says what may be wrong, not merely that versions differ', () => {
    const notice = pluginSkewNotice('0.3.0', '0.4.0');
    // The failure has no symptom of its own, so the text has to supply one.
    expect(notice).toContain('v0.3.0');
    expect(notice).toContain('v0.4.0');
    expect(notice).toMatch(/silently ignored/i);
    expect(notice).toMatch(/report success/i);
    expect(notice).toMatch(/unverified/i);
    // And the action, aimed at the agent's user rather than at a developer.
    expect(notice).toMatch(/tell the user to update/i);
    expect(notice).toContain('releases/latest');
  });

  it('quotes a version it cannot parse instead of dressing it up', () => {
    // `vnightly` — caught twice in live testing, once in each wording.
    expect(pluginSkewNotice('nightly', '0.4.0')).toContain('"nightly"');
    expect(pluginSkewNotice('nightly', '0.4.0')).not.toContain('vnightly');
  });
});

describe('checkPluginCompatibility', () => {
  it('is satisfied at or above the threshold', () => {
    expect(checkPluginCompatibility('0.4.0', '0.4.0')).toBe(true);
    expect(checkPluginCompatibility('0.4.1', '0.4.0')).toBe(true);
    // A plugin newer than the server understands every argument an older server sends, so there is
    // nothing to warn about in that direction.
    expect(checkPluginCompatibility('0.5.0', '0.4.0')).toBe(true);
  });

  it('is not satisfied below the threshold', () => {
    expect(checkPluginCompatibility('0.3.0', '0.4.0')).toBe(false);
    expect(checkPluginCompatibility('0.4.0-beta.1', '0.4.0')).toBe(false);
  });

  it('is satisfied by a same-generation plugin while the threshold is ahead of the release', () => {
    // Development on the change that raised the threshold: package.json still says 0.3.0, so both
    // halves report 0.3.0. Warning here would flag the dev plugin against the server built beside
    // it — not noise but a false statement.
    expect(checkPluginCompatibility('0.3.0', '0.3.0')).toBe(true);
  });

  it('is not satisfied by a version it cannot identify', () => {
    // Not a build this product ships. A version we cannot read is not evidence that anything is
    // fine, and the whole point is that skew is never silent.
    expect(checkPluginCompatibility('unknown', '0.4.0')).toBe(false);
    expect(checkPluginCompatibility('', '0.4.0')).toBe(false);
  });
});
