import { parse } from 'valibot';
import { describe, expect, it } from 'vitest';

import {
  createPluginContextEvent,
  createToolCall,
  createToolError,
  createToolResult,
  isPluginBridgeMessage,
  isPluginContextEvent,
  PLUGIN_BRIDGE_TAG,
  PluginBridgeMessageSchema,
  PluginContextEventSchema,
} from '../src/plugin-bridge.js';

describe('plugin-bridge envelope factories', () => {
  it('createToolCall tags and round-trips through schema', () => {
    const msg = createToolCall({ id: 'c-1', method: 'ping', params: { foo: 1 } });
    expect(msg).toEqual({
      tag: PLUGIN_BRIDGE_TAG,
      kind: 'tool-call',
      id: 'c-1',
      method: 'ping',
      params: { foo: 1 },
    });
    expect(parse(PluginBridgeMessageSchema, msg)).toEqual(msg);
  });

  it('createToolCall omits params when undefined', () => {
    const msg = createToolCall({ id: 'c-2', method: 'ping' });
    expect('params' in msg).toBe(false);
  });

  it('createToolResult omits result when undefined', () => {
    const msg = createToolResult({ id: 'r-1' });
    expect('result' in msg).toBe(false);
    expect(parse(PluginBridgeMessageSchema, msg).kind).toBe('tool-result');
  });

  it('createToolError carries code and message', () => {
    const msg = createToolError({ id: 'r-2', code: 'METHOD_NOT_FOUND', message: 'no such' });
    expect(msg.kind).toBe('tool-error');
    expect(parse(PluginBridgeMessageSchema, msg)).toEqual(msg);
  });
});

describe('isPluginBridgeMessage type guard', () => {
  it('accepts a well-formed tool-call', () => {
    expect(
      isPluginBridgeMessage(createToolCall({ id: 'x', method: 'ping' })),
    ).toBe(true);
  });

  it('rejects messages without the bridge tag', () => {
    expect(isPluginBridgeMessage({ kind: 'tool-call', id: 'x', method: 'ping' })).toBe(false);
  });

  it('rejects messages with wrong tag', () => {
    expect(
      isPluginBridgeMessage({ tag: 'other', kind: 'tool-call', id: 'x', method: 'ping' }),
    ).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isPluginBridgeMessage(null)).toBe(false);
    expect(isPluginBridgeMessage('hello')).toBe(false);
    expect(isPluginBridgeMessage(42)).toBe(false);
  });

  it('rejects tagged objects that fail schema validation', () => {
    expect(
      isPluginBridgeMessage({ tag: PLUGIN_BRIDGE_TAG, kind: 'tool-call', id: 'x' }),
    ).toBe(false);
    expect(
      isPluginBridgeMessage({ tag: PLUGIN_BRIDGE_TAG, kind: 'nope', id: 'x' }),
    ).toBe(false);
  });
});

describe('plugin context event', () => {
  const ctx = {
    fileName: 'My File',
    pageId: '1:2',
    pageName: 'Page 1',
    selectionCount: 3,
    selection: [
      { id: '1:3', name: 'Frame A', type: 'FRAME', width: 480, height: 270 },
      { id: '1:4', name: 'Label', type: 'TEXT', width: 120, height: 24 },
    ],
    editorType: 'figma',
    apiVersion: '1.0.0',
  };

  it('createPluginContextEvent tags and round-trips through schema', () => {
    const msg = createPluginContextEvent(ctx);
    expect(msg).toEqual({ tag: PLUGIN_BRIDGE_TAG, kind: 'context', ...ctx });
    expect(parse(PluginContextEventSchema, msg)).toEqual(msg);
    expect(msg.selection[0]).toMatchObject({ type: 'FRAME', width: 480, height: 270 });
  });

  it('isPluginContextEvent accepts a well-formed event', () => {
    expect(isPluginContextEvent(createPluginContextEvent(ctx))).toBe(true);
  });

  it('isPluginContextEvent rejects tool-call messages and untagged/invalid input', () => {
    expect(isPluginContextEvent(createToolCall({ id: 'x', method: 'ping' }))).toBe(false);
    expect(isPluginContextEvent({ kind: 'context', ...ctx })).toBe(false);
    expect(isPluginContextEvent({ tag: PLUGIN_BRIDGE_TAG, kind: 'context' })).toBe(false);
    expect(isPluginContextEvent(null)).toBe(false);
  });

  it('a context event is not mistaken for a tool-call bridge message', () => {
    expect(isPluginBridgeMessage(createPluginContextEvent(ctx))).toBe(false);
  });
});
