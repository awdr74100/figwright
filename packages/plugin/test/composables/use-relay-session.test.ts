import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, nextTick } from 'vue';

// @vitest-environment happy-dom
import { createPluginContextEvent, type PluginContextEvent } from '../../protocol/bridge.js';
import type { ActivityEntry, RelayClientState } from '../../ui/relay/state.js';

/**
 * The composable constructs its own RelayClient and sandbox bridge, so both are mocked at the
 * module boundary rather than injected — production code stays free of test-only seams.
 */
const mocks = vi.hoisted(() => {
  const notifyActivity = vi.fn<(p: unknown) => void>();
  const wake = vi.fn<() => void>();
  const connect = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const disconnect = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const setToolHandler = vi.fn<(h: unknown) => void>();
  const unsubscribe = vi.fn<() => void>();
  const bridgeDispose = vi.fn<() => void>();
  const bridgeHandler = vi.fn<() => void>();
  /** Captured so tests can push a new state through the subscription. */
  let emitState: ((s: RelayClientState) => void) | null = null;

  const baseState: RelayClientState = {
    status: 'idle',
    port: null,
    sessionResumed: false,
    serverVersion: null,
    lastError: null,
    versionNotice: null,
    // The connected server reads ActivityParams.foreground, so a background tab may announce its
    // file. The compatibility path (an older server, which cannot) has its own case below.
    foregroundFlag: true,
    connectedAt: null,
    reconnectCount: 0,
    totalCalls: 0,
    failedCalls: 0,
    activity: [],
  };

  return {
    notifyActivity,
    wake,
    connect,
    disconnect,
    setToolHandler,
    unsubscribe,
    bridgeDispose,
    bridgeHandler,
    baseState,
    getEmitState: () => emitState,
    setEmitState: (fn: (s: RelayClientState) => void) => {
      emitState = fn;
    },
  };
});

vi.mock('../../ui/relay/client.js', () => ({
  RelayClient: class {
    sessionId = 'session-abcdef123456';
    setToolHandler = mocks.setToolHandler;
    getState = (): RelayClientState => mocks.baseState;
    subscribe = (fn: (s: RelayClientState) => void): (() => void) => {
      mocks.setEmitState(fn);
      return mocks.unsubscribe;
    };
    notifyActivity = mocks.notifyActivity;
    wake = mocks.wake;
    connect = mocks.connect;
    disconnect = mocks.disconnect;
  },
}));

vi.mock('../../ui/sandbox/tool-bridge.js', () => ({
  createToolBridge: () => ({ handler: mocks.bridgeHandler, dispose: mocks.bridgeDispose }),
}));

const { useRelaySession } = await import('../../ui/composables/useRelaySession.js');

/**
 * Flip the tab's visibility. Awaits a tick because the composable reacts through a Vue `watch`,
 * which flushes on the microtask queue rather than synchronously with the event.
 */
const setVisibility = async (value: DocumentVisibilityState): Promise<void> => {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  await nextTick();
};

const pushContext = (overrides: Partial<PluginContextEvent> = {}): void => {
  const event = {
    ...createPluginContextEvent({
      fileName: 'Design File',
      pageId: 'page-1',
      pageName: 'Page 1',
      selectionCount: 0,
      selection: [],
      editorType: 'figma',
      mode: 'default',
      apiVersion: '1.0.0',
    }),
    ...overrides,
  };
  globalThis.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: event } }));
};

/**
 * Mount the composable inside a real component so onMounted and scope disposal both fire. Mounted
 * apps are tracked and unmounted in afterEach — a failing assertion must not leave a live window
 * listener behind to contaminate the next test.
 */
const mounted: App[] = [];
const withSession = (): ReturnType<typeof useRelaySession> => {
  let session!: ReturnType<typeof useRelaySession>;
  const app = createApp({
    setup() {
      session = useRelaySession('1.2.3');
      return () => h('div');
    },
  });
  app.mount(document.createElement('div'));
  mounted.push(app);
  return session;
};

describe('useRelaySession', () => {
  beforeEach(async () => {
    await setVisibility('visible');
  });

  afterEach(() => {
    while (mounted.length > 0) mounted.pop()?.unmount();
    vi.unstubAllGlobals();
  });

  describe('activity routing (the multi-file routing invariant)', () => {
    it('claims routing when a context arrives while this tab is in the foreground', () => {
      withSession();

      pushContext();

      expect(mocks.notifyActivity).toHaveBeenCalledWith({
        fileName: 'Design File',
        pageId: 'page-1',
        pageName: 'Page 1',
        foreground: true,
      });
    });

    // The bug this guards: a background file claiming routing and stealing tool calls from the file
    // the user is actually looking at. It guards the *claim*, which is `foreground`, not the event —
    // the event also carries this session's file identity, and withholding that left the leader
    // unable to name any file the user had not recently been in (use_file matches on those names).
    it('reports itself but never claims routing while the tab is hidden', async () => {
      await setVisibility('hidden');
      withSession();

      pushContext();

      expect(mocks.notifyActivity).toHaveBeenCalledWith({
        fileName: 'Design File',
        pageId: 'page-1',
        pageName: 'Page 1',
        foreground: false,
      });
    });

    it('still wakes the connection on a context push while hidden', async () => {
      await setVisibility('hidden');
      withSession();

      pushContext();

      // wake() is deliberately outside the visibility gate: a stalled reconnect should recover even
      // in a background tab, it just must not claim routing.
      expect(mocks.wake).toHaveBeenCalled();
      expect(mocks.notifyActivity).toHaveBeenCalledWith(
        expect.objectContaining({ foreground: false }),
      );
    });

    it('re-claims routing when the tab returns to the foreground', async () => {
      await setVisibility('hidden');
      withSession();
      pushContext();
      expect(mocks.notifyActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ foreground: false }),
      );

      await setVisibility('visible');

      expect(mocks.wake).toHaveBeenCalled();
      expect(mocks.notifyActivity).toHaveBeenLastCalledWith({
        fileName: 'Design File',
        pageId: 'page-1',
        pageName: 'Page 1',
        foreground: true,
      });
    });

    // Going to the background must be silent — emitting there is exactly how a background file used
    // to steal routing from the foreground one.
    it('emits nothing when the tab leaves the foreground', async () => {
      withSession();
      pushContext();
      vi.clearAllMocks();

      await setVisibility('hidden');

      expect(mocks.notifyActivity).not.toHaveBeenCalled();
    });

    // A leader that has just taken the port has no record of this session, so it starts out not
    // knowing which file this is — and a handover or server restart puts every open plugin in that
    // state at once. Nothing else would tell it until the user next clicked in this tab.
    it('re-announces its file whenever the connection comes up', () => {
      withSession();
      pushContext();
      vi.clearAllMocks();

      mocks.getEmitState()?.({ ...mocks.baseState, status: 'connected' });

      expect(mocks.notifyActivity).toHaveBeenCalledWith({
        fileName: 'Design File',
        pageId: 'page-1',
        pageName: 'Page 1',
        foreground: true,
      });
    });

    it('re-announces a background file without claiming routing for it', async () => {
      withSession();
      pushContext();
      await setVisibility('hidden');
      vi.clearAllMocks();

      mocks.getEmitState()?.({ ...mocks.baseState, status: 'connected' });

      expect(mocks.notifyActivity).toHaveBeenCalledWith(
        expect.objectContaining({ foreground: false }),
      );
    });

    it('announces once per connection, not on every state change', () => {
      withSession();
      pushContext();
      vi.clearAllMocks();

      const emit = mocks.getEmitState();
      emit?.({ ...mocks.baseState, status: 'connected' });
      emit?.({ ...mocks.baseState, status: 'connected', totalCalls: 1 });

      expect(mocks.notifyActivity).toHaveBeenCalledTimes(1);
    });

    it('announces again after a drop and reconnect', () => {
      withSession();
      pushContext();
      vi.clearAllMocks();

      const emit = mocks.getEmitState();
      emit?.({ ...mocks.baseState, status: 'connected' });
      emit?.({ ...mocks.baseState, status: 'reconnecting' });
      emit?.({ ...mocks.baseState, status: 'connected' });

      expect(mocks.notifyActivity).toHaveBeenCalledTimes(2);
    });

    // Against a server that predates the flag, any activity event is read as a claim on routing, so
    // a hidden tab announcing itself would let a background file steal the agent — the exact bug the
    // visibility gate was added to fix. Silence is the only safe answer there.
    it('stays silent from the background against a server that cannot read the flag', async () => {
      withSession();
      mocks.getEmitState()?.({ ...mocks.baseState, status: 'connected', foregroundFlag: false });
      await setVisibility('hidden');
      vi.clearAllMocks();

      pushContext();

      expect(mocks.notifyActivity).not.toHaveBeenCalled();
    });

    it('still claims routing from the foreground against such a server', async () => {
      withSession();
      mocks.getEmitState()?.({ ...mocks.baseState, status: 'connected', foregroundFlag: false });
      vi.clearAllMocks();

      pushContext();

      expect(mocks.notifyActivity).toHaveBeenCalledWith(
        expect.objectContaining({ foreground: true }),
      );
    });

    it('says nothing on connect before any context has arrived', () => {
      withSession();

      mocks.getEmitState()?.({ ...mocks.baseState, status: 'connected' });

      // No context yet means no file identity to announce.
      expect(mocks.notifyActivity).not.toHaveBeenCalled();
    });

    it('does not claim routing before any context has arrived', async () => {
      await setVisibility('hidden');
      withSession();

      await setVisibility('visible');

      // No context yet means no file/page identity to report, so there is nothing to claim.
      expect(mocks.notifyActivity).not.toHaveBeenCalled();
    });

    it('reports the newest file and page after the user switches page', () => {
      withSession();
      pushContext();
      pushContext({ pageId: 'page-2', pageName: 'Page 2' });

      expect(mocks.notifyActivity).toHaveBeenLastCalledWith({
        fileName: 'Design File',
        pageId: 'page-2',
        pageName: 'Page 2',
        foreground: true,
      });
    });

    it('ignores window messages that are not plugin context events', () => {
      withSession();

      globalThis.dispatchEvent(
        new MessageEvent('message', { data: { pluginMessage: { type: 'something-else' } } }),
      );

      expect(mocks.notifyActivity).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('wires the sandbox bridge as the tool handler and connects on mount', () => {
      withSession();

      expect(mocks.setToolHandler).toHaveBeenCalledWith(mocks.bridgeHandler);
      expect(mocks.connect).toHaveBeenCalled();
    });

    it('mirrors relay state into a ref', () => {
      const session = withSession();
      expect(session.state.value.status).toBe('idle');

      mocks.getEmitState()?.({ ...mocks.baseState, status: 'connected', port: 3055 });

      expect(session.state.value.status).toBe('connected');
      expect(session.state.value.port).toBe(3055);
    });

    it('tears down subscription, bridge and socket on unmount', () => {
      withSession();

      mounted.pop()?.unmount();

      expect(mocks.unsubscribe).toHaveBeenCalled();
      expect(mocks.bridgeDispose).toHaveBeenCalled();
      expect(mocks.disconnect).toHaveBeenCalled();
    });

    it('exposes the context pushed from the sandbox', () => {
      const session = withSession();
      expect(session.context.value).toBeNull();

      pushContext();

      expect(session.context.value?.fileName).toBe('Design File');
    });

    it('stops listening for context once unmounted', () => {
      const session = withSession();
      mounted.pop()?.unmount();

      pushContext();

      expect(session.context.value).toBeNull();
    });
  });

  // Derived here rather than in the panel: "the agent is working" is a fact about the session, and
  // more than one piece of chrome reads it.
  describe('busy', () => {
    const entry = (id: string, status: ActivityEntry['status']): ActivityEntry => ({
      id,
      method: 'get_node',
      startedAt: 1000,
      status,
    });

    const withActivity = (activity: ActivityEntry[]): void => {
      mocks.getEmitState()?.({ ...mocks.baseState, activity });
    };

    it('is quiet before anything has happened', () => {
      expect(withSession().busy.value).toBe(false);
    });

    it('stays quiet once every call has settled', () => {
      const session = withSession();

      withActivity([entry('a', 'ok'), entry('b', 'error')]);

      expect(session.busy.value).toBe(false);
    });

    // The sweep has to appear even when the pending row itself is scrolled out of view.
    it('reports a call in flight wherever it sits in the list', () => {
      const session = withSession();

      withActivity([entry('a', 'ok'), entry('b', 'pending')]);

      expect(session.busy.value).toBe(true);
    });

    it('goes quiet again when the last call settles', () => {
      const session = withSession();
      withActivity([entry('a', 'pending')]);
      expect(session.busy.value).toBe(true);

      withActivity([entry('a', 'ok')]);

      expect(session.busy.value).toBe(false);
    });
  });

  describe('diagnostics', () => {
    it('builds a bundle carrying the session id, versions and context', () => {
      const session = withSession();
      pushContext();

      const bundle = JSON.parse(session.buildDiagnostics()) as {
        versions: { plugin: string; editorType: string | null };
        session: { id: string };
        context: { fileName: string } | null;
      };

      expect(bundle.versions.plugin).toBe('1.2.3');
      expect(bundle.versions.editorType).toBe('figma');
      expect(bundle.session.id).toBe('session-abcdef123456');
      expect(bundle.context?.fileName).toBe('Design File');
    });
  });
});
