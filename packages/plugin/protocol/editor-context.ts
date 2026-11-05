/**
 * What the plugin API actually offers in each editor `manifest.json` claims.
 *
 * The manifest lists three editors — `figma`, `figjam`, `dev` — but the API is not the same in all
 * three, and nothing in the type system says so: `figma.createFrame()` compiles everywhere and
 * throws in two of them. `figma.editorType` is the only thing that knows, and until this module
 * existed only the Motion handlers consulted it, so the other ~100 handlers met FigJam and Dev Mode
 * by throwing whatever the plugin API happened to throw. The manifest had been claiming three
 * editors while the code was written for one.
 *
 * It lives in `protocol/` for the same reason `panel-control.ts` does: both execution contexts need
 * it and neither owns it. The sandbox appends the limitation to handler errors so an agent can
 * re-plan; the panel shows it in the Context tab so the human can see why writes are failing. One
 * table, two readers — the alternative is the same sentence maintained in two places, drifting.
 * Types, constants and pure functions only, so it stays importable from a context with no `figma`
 * and one with no DOM.
 *
 * It used to go on every error raised in those editors. That told an agent whose call was refused
 * for its own arguments — a maxLines without an ellipsis, a node id that matches nothing — that the
 * editor was the reason, and sent it off to open another file instead of fixing the call. It now
 * goes on an error the editor can be behind, decided from what each editor was measured to raise
 * when every tool was called in it with arguments Figma Design accepts:
 *
 * - Dev Mode refuses every write, so any write's error carries it — even one refused for its own
 *   arguments, which would only be refused again once fixed — and a read's only when it has Figma's
 *   refusal ("in read-only mode") somewhere in it, a handler's own wording wrapped round it
 *   included.
 * - FigJam's missing APIs throw "cannot read property 'X' of undefined" or "not a function", and a
 *   handler that reaches for a component, an instance or Figma Motion first finds none and says so
 *   in its own words ("is not an INSTANCE", "is not a component"). Either carries it.
 *
 * Neither needs a list of tools: whether a handler writes is the registry's own split (the
 * dispatcher's `markWriteHandler`), and the rest is read off the error. A new tool that hits a
 * limit gets the sentence without anyone listing it.
 */

/**
 * Editors whose plugin API is narrower than Figma Design's, and the one sentence an agent needs to
 * re-plan. Keyed by `figma.editorType`; absent means no limitation worth stating.
 *
 * Both sentences were rewritten after being checked against the real editors, because both were
 * wrong in the same direction — guessed from what the editors look like rather than what their API
 * exposes:
 *
 * - Dev Mode rejects `createFrame`, `createPage`, `createVariableCollection` and `createPaintStyle`
 *   alike, all with `Can't call "X" in read-only mode`. The first draft said only "nodes", which
 *   would have left an agent thinking variables were still writable. The wording also avoids
 *   repeating "read-only" — Figma's own message says it; what this adds is the scope and the exit.
 * - FigJam **does** have frames: `createFrame`, `createSection`, `createRectangle` and `createText`
 *   all succeed there. What it lacks is components, variables and styles, whose APIs are missing
 *   outright — `figma.variables` is `undefined` and `createPaintStyle` is `not a function`, so the
 *   raw errors ("not a function") say nothing about the editor at all. That makes the suffix carry
 *   more weight here than in Dev Mode, where Figma's own message is already explicit.
 *
 * `slides` and `buzz` exist in the typings but are not in our manifest's `editorType`, so the
 * plugin can never run there — they are omitted rather than guessed at.
 */
interface EditorLimitation {
  sentence: string;
  /** The editor's own refusal, found in the error or anything it wraps. */
  refusal: RegExp;
  /** A handler's own words for meeting something the editor lacks. */
  lacks?: RegExp;
  /** The editor refuses every write, so a write's error carries the sentence whatever it says. */
  refusesWrites?: true;
}

const EDITOR_LIMITATIONS: Readonly<Record<string, EditorLimitation>> = {
  dev: {
    sentence:
      'Dev Mode blocks every write — nodes, pages, variables and styles alike. Reads, exports ' +
      '(screenshots, PDF) and plugin data still work. Switch the file to Design mode to make ' +
      'changes.',
    // Measured: `in createFrame: Can't call "createFrame" in read-only mode` for a create, and
    // `in set_name: Can't set "name" in read-only mode` for a property write.
    refusal: /in read-only mode/,
    refusesWrites: true,
  },
  figjam: {
    sentence:
      'FigJam has no components, variables, styles or Figma Motion, so the tools that read or ' +
      'edit them fail there — frames, sections, shapes and text all work. Open a Figma Design file ' +
      'for the rest.',
    // Measured: `cannot read property 'createVariableCollection' of undefined` (figma.variables is
    // missing) and a bare `not a function` (createPaintStyle, createComponent, getLocalPaintStyles
    // are). The V8 wording of the first, "Cannot read properties of undefined", is matched too.
    refusal: /cannot read propert(?:y|ies)\b.*\bof undefined|\bnot a function\b/i,
    // Measured: "node 0:0 is not an INSTANCE", "… is not a component or component set", "Figma
    // Motion is only available in the Figma Design editor", "the Figma Motion API is not available
    // here". Variables and styles need no words of their own: their APIs are missing outright.
    lacks: /\b(?:components?|instances?|variants?|motion)\b/i,
  },
};

/** The limitation an agent (or the user) should know about in `editorType`, or null in Figma Design. */
export const editorLimitation = (editorType: string): string | null =>
  EDITOR_LIMITATIONS[editorType]?.sentence ?? null;

/** An error's message and those of the errors it wraps (`cause`), outermost first. */
const messagesOf = (error: unknown): string[] => {
  const messages: string[] = [];
  for (let e = error, depth = 0; e !== undefined && e !== null && depth < 8; depth++) {
    messages.push(e instanceof Error ? e.message : String(e));
    e = e instanceof Error ? e.cause : undefined;
  }
  return messages;
};

/**
 * A handler error's message, with the current editor's limitation appended when the editor can be
 * behind it (see the module doc). Phrased as `(editor: X — …)`. Any other error — the call's own
 * arguments refused by a tool the editor allows, a node not found — is returned untouched, as it is
 * in Figma Design.
 */
export const withEditorContext = (error: unknown, editorType: string, write: boolean): string => {
  const [message = '', ...wrapped] = messagesOf(error);
  const limitation = EDITOR_LIMITATIONS[editorType];
  if (limitation === undefined) return message;
  const applies =
    (write && limitation.refusesWrites === true) ||
    [message, ...wrapped].some(m => limitation.refusal.test(m)) ||
    (limitation.lacks?.test(message) ?? false);
  return applies ? `${message} (editor: ${editorType} — ${limitation.sentence})` : message;
};

/**
 * Whether our UI is an iframe filling Dev Mode's Inspect panel rather than a floating plugin
 * window. Keyed off `figma.mode`, not `editorType`: the two are independent, and it is the launch
 * mode — not the document's read-only-ness — that decides whether the window chrome the panel draws
 * for itself (resize grip, run-in-background) has anything to act on.
 *
 * Only `inspect` is matched. `codegen` is the other embedded mode, but reaching it needs a
 * `codegen` capability this manifest does not declare, so treating it as embedded would be
 * speculation about a state the plugin cannot be in.
 */
export const isEmbeddedInPanel = (mode: string): boolean => mode === 'inspect';
