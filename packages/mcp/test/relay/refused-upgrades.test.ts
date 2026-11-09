import { describe, expect, it } from 'vitest';

import {
  parseRefusedUpgrades,
  RefusedUpgradeLog,
  type RefusedUpgrades,
  userAgentRefusalNotice,
} from '../../src/relay/refused-upgrades.js';

describe('RefusedUpgradeLog', () => {
  it('reports nothing until something is refused, so a clean ping is unchanged', () => {
    expect(new RefusedUpgradeLog().snapshot()).toBeNull();
  });

  it('counts by reason and keeps the latest refusal', () => {
    const log = new RefusedUpgradeLog();
    log.record('host', undefined, undefined);
    log.record('origin', 'https://evil.example', 'Mozilla/5.0');
    log.record('user-agent', 'null', 'Mozilla/5.0 Chrome/157');
    log.record('user-agent', 'null', undefined);
    const snap = log.snapshot();
    expect(snap).toMatchObject({ host: 1, origin: 1, userAgent: 2 });
    expect(snap?.last).toMatchObject({ reason: 'user-agent', origin: 'null', userAgent: null });
    expect(typeof snap?.last?.at).toBe('number');
  });

  it('caps the echoed headers, which are untrusted', () => {
    const log = new RefusedUpgradeLog();
    log.record('user-agent', 'x'.repeat(5000), 'y'.repeat(5000));
    expect(log.snapshot()?.last?.origin).toHaveLength(200);
    expect(log.snapshot()?.last?.userAgent).toHaveLength(200);
  });

  it('hands out a copy, so a caller cannot alter the record', () => {
    const log = new RefusedUpgradeLog();
    log.record('origin', 'https://evil.example', undefined);
    const snap = log.snapshot() as RefusedUpgrades;
    snap.origin = 99;
    if (snap.last !== null) snap.last.origin = 'tampered';
    expect(log.snapshot()).toMatchObject({ origin: 1, last: { origin: 'https://evil.example' } });
  });
});

describe('userAgentRefusalNotice', () => {
  const base: RefusedUpgrades = { host: 0, origin: 0, userAgent: 0, last: null };

  it('says nothing when no refusal could have been the plugin', () => {
    expect(userAgentRefusalNotice(null)).toBeNull();
    expect(userAgentRefusalNotice({ ...base, host: 2, origin: 5 })).toBeNull();
  });

  it('names the count, the latest User-Agent, the escape hatch and where to report', () => {
    const notice = userAgentRefusalNotice({
      ...base,
      userAgent: 3,
      last: { reason: 'user-agent', at: 0, origin: 'null', userAgent: 'Mozilla/5.0 Chrome/157' },
    });
    expect(notice).toMatch(/^3 plugin connection\(s\) were refused/);
    expect(notice).toContain('1970-01-01T00:00:00.000Z');
    expect(notice).toContain('"Mozilla/5.0 Chrome/157"');
    expect(notice).toContain('FIGWRIGHT_ALLOW_ANY_ORIGIN=1');
    // The leader is the one that checks, so the escape hatch has to reach it: set on every
    // server, not only on the one the user happens to be talking to.
    expect(notice).toContain('every Figwright MCP server');
    expect(notice).toContain('holding port 3055');
    expect(notice).toContain('github.com/awdr74100/figwright/issues');
  });

  it('omits the latest detail when the latest refusal was for another reason', () => {
    const notice = userAgentRefusalNotice({
      ...base,
      userAgent: 1,
      origin: 1,
      last: { reason: 'origin', at: 0, origin: 'https://evil.example', userAgent: null },
    });
    expect(notice).toMatch(/^1 plugin connection\(s\) were refused because/);
    expect(notice).not.toContain('evil.example');
  });
});

describe('parseRefusedUpgrades', () => {
  const valid: RefusedUpgrades = {
    host: 1,
    origin: 2,
    userAgent: 3,
    last: { reason: 'user-agent', at: 1234, origin: 'null', userAgent: 'UA' },
  };

  it('round-trips what a leader writes', () => {
    expect(parseRefusedUpgrades(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
    expect(parseRefusedUpgrades({ ...valid, last: null })).toEqual({ ...valid, last: null });
  });

  it('ignores an absent or malformed field rather than doubting the leader', () => {
    expect(parseRefusedUpgrades(undefined)).toBeUndefined();
    expect(parseRefusedUpgrades(null)).toBeUndefined();
    expect(parseRefusedUpgrades('3')).toBeUndefined();
    expect(parseRefusedUpgrades({ ...valid, host: -1 })).toBeUndefined();
    expect(parseRefusedUpgrades({ ...valid, origin: 1.5 })).toBeUndefined();
    expect(parseRefusedUpgrades({ ...valid, userAgent: '3' })).toBeUndefined();
    expect(parseRefusedUpgrades({ ...valid, last: undefined })).toBeUndefined();
    expect(
      parseRefusedUpgrades({ ...valid, last: { ...valid.last, reason: 'other' } }),
    ).toBeUndefined();
    expect(parseRefusedUpgrades({ ...valid, last: { ...valid.last, at: '0' } })).toBeUndefined();
    expect(parseRefusedUpgrades({ ...valid, last: { ...valid.last, origin: 5 } })).toBeUndefined();
  });

  it('caps the strings it takes from the leader', () => {
    const parsed = parseRefusedUpgrades({
      ...valid,
      last: { ...valid.last, origin: 'o'.repeat(900), userAgent: 'u'.repeat(900) },
    });
    expect(parsed?.last?.origin).toHaveLength(200);
    expect(parsed?.last?.userAgent).toHaveLength(200);
  });
});
