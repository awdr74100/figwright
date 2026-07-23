import { afterEach, describe, expect, it } from 'vitest';

import {
  hasContentType,
  isAllowedHost,
  isAllowedHttpOrigin,
  isAllowedWsOrigin,
} from '../src/local-access.js';

afterEach(() => {
  delete process.env.FIGWRIGHT_ALLOW_ANY_ORIGIN;
});

describe('isAllowedHost', () => {
  it('admits the loopback names a real caller uses, port and case notwithstanding', () => {
    expect(isAllowedHost('127.0.0.1:3055')).toBe(true);
    expect(isAllowedHost('localhost:3055')).toBe(true);
    expect(isAllowedHost('LocalHost:3055')).toBe(true);
    expect(isAllowedHost('127.0.0.1')).toBe(true);
    expect(isAllowedHost('[::1]:3055')).toBe(true);
  });

  it('refuses a rebound domain, the one header the attacking page cannot change', () => {
    expect(isAllowedHost('evil.example:3055')).toBe(false);
    expect(isAllowedHost('attacker.com')).toBe(false);
  });

  it('is not fooled by a loopback-looking name', () => {
    expect(isAllowedHost('localhost.evil.example:3055')).toBe(false);
    expect(isAllowedHost('127.0.0.1.evil.example')).toBe(false);
    expect(isAllowedHost('notlocalhost:3055')).toBe(false);
  });

  it('refuses a request with no Host at all', () => {
    expect(isAllowedHost(undefined)).toBe(false);
    expect(isAllowedHost('')).toBe(false);
  });

  it('stays enforced under the origin escape hatch, which does not cover it', () => {
    process.env.FIGWRIGHT_ALLOW_ANY_ORIGIN = '1';
    expect(isAllowedHost('evil.example:3055')).toBe(false);
  });
});

describe('isAllowedWsOrigin', () => {
  it('admits the real plugin, whose sandboxed iframe serializes its origin as "null"', () => {
    expect(isAllowedWsOrigin('null')).toBe(true);
  });

  it('admits a non-browser client, which sends no Origin at all', () => {
    expect(isAllowedWsOrigin(undefined)).toBe(true);
    expect(isAllowedWsOrigin('')).toBe(true);
  });

  it('admits a plugin host that sends a real figma.com origin', () => {
    expect(isAllowedWsOrigin('https://www.figma.com')).toBe(true);
    expect(isAllowedWsOrigin('https://figma.com')).toBe(true);
  });

  it('refuses a web page, which would otherwise claim a session and win routing', () => {
    expect(isAllowedWsOrigin('https://evil.example')).toBe(false);
    expect(isAllowedWsOrigin('http://localhost:5173')).toBe(false);
    expect(isAllowedWsOrigin('null.evil.example')).toBe(false);
  });

  it('does not fall for a lookalike host', () => {
    expect(isAllowedWsOrigin('https://figma.com.evil.example')).toBe(false);
    expect(isAllowedWsOrigin('http://www.figma.com')).toBe(false);
  });

  it('opens up under the escape hatch', () => {
    process.env.FIGWRIGHT_ALLOW_ANY_ORIGIN = '1';
    expect(isAllowedWsOrigin('https://evil.example')).toBe(true);
  });
});

describe('isAllowedHttpOrigin', () => {
  it('admits a follower, which reaches the leader over fetch and sets no Origin', () => {
    expect(isAllowedHttpOrigin(undefined)).toBe(true);
    expect(isAllowedHttpOrigin('')).toBe(true);
  });

  it('refuses every browser origin, figma.com included', () => {
    expect(isAllowedHttpOrigin('https://evil.example')).toBe(false);
    expect(isAllowedHttpOrigin('null')).toBe(false);
    expect(isAllowedHttpOrigin('https://www.figma.com')).toBe(false);
  });

  it('opens up under the escape hatch', () => {
    process.env.FIGWRIGHT_ALLOW_ANY_ORIGIN = '1';
    expect(isAllowedHttpOrigin('https://evil.example')).toBe(true);
  });
});

describe('hasContentType', () => {
  it('matches ignoring parameters and case', () => {
    expect(hasContentType('application/msgpack', 'application/msgpack')).toBe(true);
    expect(hasContentType('Application/MsgPack; charset=utf-8', 'application/msgpack')).toBe(true);
    expect(hasContentType(' application/json ', 'application/json')).toBe(true);
  });

  it('rejects the simple-request media types a page can send without a preflight', () => {
    expect(hasContentType('text/plain', 'application/msgpack')).toBe(false);
    expect(hasContentType('multipart/form-data', 'application/msgpack')).toBe(false);
    expect(hasContentType('application/x-www-form-urlencoded', 'application/msgpack')).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(hasContentType(undefined, 'application/msgpack')).toBe(false);
  });
});
