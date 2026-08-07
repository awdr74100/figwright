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
  it('accepts a plugin at or above the floor', () => {
    expect(checkPluginCompatibility('0.4.0', '0.4.0').compatible).toBe(true);
    expect(checkPluginCompatibility('0.5.0', '0.4.0').compatible).toBe(true);
    // A plugin newer than the server is fine: it understands every argument an older server sends.
    expect(checkPluginCompatibility('0.5.0', '0.4.0').compatible).toBe(true);
  });

  it('refuses a plugin below the floor', () => {
    const result = checkPluginCompatibility('0.3.0', '0.4.0');
    expect(result.compatible).toBe(false);
    expect(result.required).toBe('0.4.0');
  });

  it('accepts a same-generation plugin while the floor is still ahead of the release', () => {
    // Development on the change that raised the floor: package.json still says 0.3.0, so both halves
    // report 0.3.0. Refusing here would break the dev loop for everyone on that branch.
    expect(checkPluginCompatibility('0.3.0', '0.3.0').compatible).toBe(true);
  });

  it('refuses a plugin whose version cannot be identified', () => {
    // Not a build this product ships. The gate exists so skew cannot proceed on a guess, and an
    // unreadable version is exactly that.
    expect(checkPluginCompatibility('unknown', '0.4.0').compatible).toBe(false);
    expect(checkPluginCompatibility('', '0.4.0').compatible).toBe(false);
  });
});
