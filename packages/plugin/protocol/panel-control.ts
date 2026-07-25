/**
 * The panel's own control channel: messages the UI iframe sends up to the sandbox to drive the
 * plugin _window_ itself — resize it, hide it, or jump the canvas to a node.
 *
 * It is a channel of its own, separate from the tool bridge (`@figwright/shared`'s
 * `PluginBridgeMessage`), because direction and shape differ: tool traffic is a two-way
 * request/response RPC that originates with the agent, while these are one-way commands the human's
 * own clicks produce. Its own tag lets `figma.ui.onmessage` split the two with a single string
 * compare, and lets either side add a message kind with no chance of colliding with the other.
 *
 * It lives _beside_ `src/` and `ui/` rather than inside either, because neither end owns it. Those
 * two are execution contexts, not modules: they build into separate bundles, the sandbox has
 * `figma` and no DOM, the panel a DOM and no `figma`, and neither one's runtime code can import the
 * other's. Both can import this precisely because it touches neither environment — types, constants
 * and pure functions only — and sitting outside both is what keeps that constraint legible. Nothing
 * enforces it: one tsconfig covers all three trees, so a stray `document` in here would typecheck
 * and then fail at runtime inside the sandbox.
 *
 * That placement also keeps it clear of `@figwright/shared`, which binds a different pair — plugin
 * and server. Two names for two boundaries; filing this there would erode `shared` into "things
 * more than one file happens to need".
 *
 * Both ends of the plugin import this module, which is what makes the window's floor and its
 * clamping rule a single fact rather than two implementations that drift apart.
 *
 * Validation is hand-written rather than Zod (which the bridge protocol in `shared` does use), for
 * a reason worth stating: the bridge crosses a process boundary between independently-versioned
 * peers and carries `unknown` tool params, so it needs a schema. This channel's two ends ship in
 * one plugin build and are deployed atomically — there is no version skew to absorb, and the
 * payloads are five scalars. A guard keeps the check exact without making `zod` a direct dependency
 * of a package that has three.
 */

export const PANEL_CONTROL_TAG = '@figwright/panel';

/**
 * Floor for the plugin window. Below this the header (status + tabs) and the footer stop fitting,
 * and the panel reads as broken rather than small.
 */
export const PANEL_MIN_SIZE = { width: 280, height: 300 } as const;

/**
 * Size the window opens at, before any stored preference is restored. Only a little above the
 * floor: the panel is an ambient status surface, so it should claim as little of the canvas as it
 * can while still showing a few activity rows.
 */
export const PANEL_DEFAULT_SIZE = { width: 292, height: 312 } as const;

export interface PanelSize {
  width: number;
  height: number;
}

/**
 * The one clamping rule, applied identically on both ends of the channel.
 *
 * The UI clamps so the grip can't run away past the floor while the pointer keeps moving; the
 * sandbox clamps again because it also restores sizes from `clientStorage` that may predate the
 * current floor. Flooring (rather than rounding) means a drag can never ask for a fractional size,
 * and a value that survived one clamp is unchanged by the next — so the two calls compose instead
 * of fighting.
 */
export const clampPanelSize = (width: number, height: number): PanelSize => ({
  width: Math.max(PANEL_MIN_SIZE.width, Math.floor(width)),
  height: Math.max(PANEL_MIN_SIZE.height, Math.floor(height)),
});

/** Hide the panel; the iframe — and with it the relay socket — stays alive. */
export interface PanelHide {
  tag: typeof PANEL_CONTROL_TAG;
  kind: 'panel-hide';
}

/** Live window resize from the drag grip. `persist` is set once, on release. */
export interface PanelResize extends PanelSize {
  tag: typeof PANEL_CONTROL_TAG;
  kind: 'panel-resize';
  persist: boolean;
}

/** Select and frame the nodes a recorded tool call touched. Never carries an empty list. */
export interface PanelReveal {
  tag: typeof PANEL_CONTROL_TAG;
  kind: 'panel-reveal';
  nodeIds: string[];
}

export type PanelControlMessage = PanelHide | PanelResize | PanelReveal;

export const createPanelHide = (): PanelHide => ({
  tag: PANEL_CONTROL_TAG,
  kind: 'panel-hide',
});

export const createPanelResize = (size: PanelSize, persist: boolean): PanelResize => ({
  tag: PANEL_CONTROL_TAG,
  kind: 'panel-resize',
  width: size.width,
  height: size.height,
  persist,
});

export const createPanelReveal = (nodeIds: readonly string[]): PanelReveal => ({
  tag: PANEL_CONTROL_TAG,
  kind: 'panel-reveal',
  // Copy: the caller's array is reactive UI state, and the message must not carry a live reference.
  nodeIds: [...nodeIds],
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Recognize a control message, or return null so the caller falls through to tool dispatch.
 *
 * The tag is checked first, so the far more frequent tool traffic is turned away by a single string
 * compare. Every field is then checked outright: a malformed message is dropped whole rather than
 * applied in part, since a half-applied resize is a visible defect and a silent one is not.
 */
export const parsePanelControl = (raw: unknown): PanelControlMessage | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  if (msg.tag !== PANEL_CONTROL_TAG) return null;

  switch (msg.kind) {
    case 'panel-hide': {
      return createPanelHide();
    }
    case 'panel-resize': {
      if (!isFiniteNumber(msg.width) || !isFiniteNumber(msg.height)) return null;
      if (typeof msg.persist !== 'boolean') return null;
      return createPanelResize({ width: msg.width, height: msg.height }, msg.persist);
    }
    case 'panel-reveal': {
      if (!Array.isArray(msg.nodeIds)) return null;
      // Keep the ids that are usable rather than dropping the request over one stray value — a
      // reveal that frames most of what was asked for still lands the user in the right place.
      const nodeIds = msg.nodeIds.filter((id): id is string => typeof id === 'string');
      // "Nothing was asked for" and "nothing was found" deserve different responses, and only the
      // latter warrants a notice — so an empty request must never reach the sandbox at all.
      return nodeIds.length === 0 ? null : createPanelReveal(nodeIds);
    }
    default: {
      return null;
    }
  }
};
