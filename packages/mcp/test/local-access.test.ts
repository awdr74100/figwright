import { afterEach, describe, expect, it } from 'vitest';

import {
  hasContentType,
  isAllowedHost,
  isAllowedHttpOrigin,
  isAllowedWsOrigin,
  isFigmaDesktopUserAgent,
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

// Captured from the Figma desktop app's own plugin handshake.
const FIGMA_MAC_ARM =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Figma/126.11.8 Chrome/152.0.7977.169 Electron/44.10.0 Safari/537.36 FigmaARM';
const FIGMA_WINDOWS_X64 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Figma/126.11.8 Chrome/152.0.7977.169 Electron/44.10.0 Safari/537.36';
// What Figma's own UA builder yields for a renamed build and for the installer flavours.
const FIGMA_BETA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Figma Beta/127.0.1 Figma/127.0.1 Chrome/152.0.7977.169 Electron/44.10.0 Safari/537.36';
const FIGMA_MSI = `${FIGMA_WINDOWS_X64} FigmaMSI`;
const FIGMA_PKG = `${FIGMA_MAC_ARM.replace(' FigmaARM', '')} FigmaPKG`;

const BROWSERS = {
  chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/157.0.0.0 Safari/537.36',
  edge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
    'Version/19.1 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:146.0) Gecko/20100101 Firefox/146.0',
  // Another Electron app: its own name token, not Figma's.
  electronApp:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Code/1.110.0 Chrome/152.0.7977.169 Electron/44.10.0 Safari/537.36',
};

describe('isAllowedWsOrigin', () => {
  it.each([
    ['macOS arm64', FIGMA_MAC_ARM],
    ['Windows x64', FIGMA_WINDOWS_X64],
    ['Beta', FIGMA_BETA],
    ['MSI install', FIGMA_MSI],
    ['PKG install', FIGMA_PKG],
  ])('admits the plugin in the Figma desktop app (%s), origin "null"', (_name, ua) => {
    expect(isAllowedWsOrigin('null', ua)).toBe(true);
  });

  it.each(Object.entries(BROWSERS))(
    'refuses a "null" origin from a browser tab (%s): a sandboxed iframe on any site sends that too',
    (_name, ua) => {
      expect(isAllowedWsOrigin('null', ua)).toBe(false);
    },
  );

  it('refuses a "null" origin that carries no User-Agent, which a browser never omits', () => {
    expect(isAllowedWsOrigin('null', undefined)).toBe(false);
    expect(isAllowedWsOrigin('null', '')).toBe(false);
  });

  it('wants the Figma token itself, not a lookalike name or a mention elsewhere', () => {
    expect(isAllowedWsOrigin('null', `${BROWSERS.chrome} NotFigma/1.0`)).toBe(false);
    expect(isAllowedWsOrigin('null', `${BROWSERS.chrome} figma-linux/0.11.5`)).toBe(false);
    expect(isAllowedWsOrigin('null', `${BROWSERS.chrome} Figma/`)).toBe(false);
  });

  it('applies the same rule to a figma.com origin', () => {
    expect(isAllowedWsOrigin('https://www.figma.com', FIGMA_MAC_ARM)).toBe(true);
    expect(isAllowedWsOrigin('https://figma.com', FIGMA_WINDOWS_X64)).toBe(true);
    expect(isAllowedWsOrigin('https://www.figma.com', BROWSERS.chrome)).toBe(false);
  });

  it('admits a non-browser client, which sends no Origin at all, whatever its User-Agent', () => {
    expect(isAllowedWsOrigin(undefined, undefined)).toBe(true);
    expect(isAllowedWsOrigin('', undefined)).toBe(true);
    expect(isAllowedWsOrigin(undefined, 'node')).toBe(true);
  });

  it('refuses a web page origin even with the desktop app UA', () => {
    expect(isAllowedWsOrigin('https://evil.example', FIGMA_MAC_ARM)).toBe(false);
    expect(isAllowedWsOrigin('http://localhost:5173', FIGMA_MAC_ARM)).toBe(false);
    expect(isAllowedWsOrigin('null.evil.example', FIGMA_MAC_ARM)).toBe(false);
  });

  it('does not fall for a lookalike host', () => {
    expect(isAllowedWsOrigin('https://figma.com.evil.example', FIGMA_MAC_ARM)).toBe(false);
    expect(isAllowedWsOrigin('http://www.figma.com', FIGMA_MAC_ARM)).toBe(false);
  });

  it('opens up under the escape hatch', () => {
    process.env.FIGWRIGHT_ALLOW_ANY_ORIGIN = '1';
    expect(isAllowedWsOrigin('https://evil.example', undefined)).toBe(true);
    expect(isAllowedWsOrigin('null', BROWSERS.chrome)).toBe(true);
  });
});

describe('isFigmaDesktopUserAgent', () => {
  it('recognises the desktop app on both platforms and refuses browsers', () => {
    expect(isFigmaDesktopUserAgent(FIGMA_MAC_ARM)).toBe(true);
    expect(isFigmaDesktopUserAgent(FIGMA_WINDOWS_X64)).toBe(true);
    for (const ua of Object.values(BROWSERS)) expect(isFigmaDesktopUserAgent(ua)).toBe(false);
    expect(isFigmaDesktopUserAgent(undefined)).toBe(false);
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
