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
 * The fix deliberately carries no list of which tools write. A list would be a second source of
 * truth beside the tool registry and would drift the first time a tool is added — the same failure
 * mode as any hand-kept mirror. Instead the editor's limitation is appended to whatever error the
 * API already produced: only the calls an editor rejects ever reach that path, so the set stays
 * correct by construction.
 *
 * The wording is a statement about the environment, never a claim about this particular failure. An
 * agent that hits "node not found" in Dev Mode should not be told read-only was the cause — it
 * should be told which editor it is standing in, and left to draw its own conclusion.
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
const EDITOR_LIMITATIONS: Readonly<Record<string, string>> = {
  dev:
    'Dev Mode blocks every write — nodes, pages, variables and styles alike. Reads, exports ' +
    '(screenshots, PDF) and plugin data still work. Switch the file to Design mode to make ' +
    'changes.',
  figjam:
    'FigJam has no components, variables or styles, so the tools that read or edit them fail ' +
    'there — frames, sections, shapes and text all work. Open a Figma Design file for the rest.',
};

/** The limitation an agent (or the user) should know about in `editorType`, or null in Figma Design. */
export const editorLimitation = (editorType: string): string | null =>
  EDITOR_LIMITATIONS[editorType] ?? null;

/**
 * Append the current editor's limitation to a handler error.
 *
 * Phrased as `(editor: X — …)` so it reads as the environment the call was made in rather than a
 * diagnosis of it. In Figma Design — the overwhelmingly common case — the message is returned
 * untouched, so this adds no noise to the errors most users ever see.
 */
export const withEditorContext = (message: string, editorType: string): string => {
  const limitation = editorLimitation(editorType);
  return limitation === null ? message : `${message} (editor: ${editorType} — ${limitation})`;
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
