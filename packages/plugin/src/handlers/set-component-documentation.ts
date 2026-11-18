import type { ComponentDocumentationResult, DocumentationLinkInfo } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import {
  type DescriptionRequest,
  hasFormatting,
  quoteForMessage,
  restoreDocumentation,
  snapshotDocumentation,
  writeDescription,
} from '../documentation.js';

const TOOL = 'set_component_documentation';

/** The node types that carry documentation in Figma's API. */
type DocumentedComponent = ComponentNode | ComponentSetNode;

/**
 * The component or component set `nodeId` names, refused with a message that says where to go
 * instead. Figma itself does not refuse the wrong node: an INSTANCE or a FRAME has none of these
 * fields, and assigning one is silently ignored (measured), so the call would answer ok having
 * written nothing.
 */
export const resolveDocumentedComponent = async (
  figmaCtx: typeof figma,
  nodeId: string,
  tool: string,
): Promise<DocumentedComponent> => {
  const node = await figmaCtx.getNodeByIdAsync(nodeId);
  if (node === null) throw new Error(`${tool}: node ${nodeId} not found`);
  if (node.type === 'INSTANCE') {
    const main = await node.getMainComponentAsync();
    if (main === null) {
      throw new Error(
        `${tool}: node ${nodeId} is an INSTANCE with no main component; documentation lives on a ` +
          'component or component set',
      );
    }
    const set = main.parent?.type === 'COMPONENT_SET' ? main.parent : null;
    const owner =
      set === null
        ? `its main component ${main.id}`
        : `its main component ${main.id}, a variant of component set ${set.id}`;
    const library = main.remote
      ? ', which comes from a library and is documented in the file it is published from'
      : '';
    throw new Error(
      `${tool}: node ${nodeId} is an INSTANCE; documentation belongs to ${owner}${library}`,
    );
  }
  if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
    throw new Error(
      `${tool}: node ${nodeId} is a ${node.type}; only a component or component set has ` +
        'documentation',
    );
  }
  if (node.remote) {
    // Figma's own refusal blames "a remote style or component" and names neither.
    throw new Error(
      `${tool}: ${node.type === 'COMPONENT' ? 'component' : 'component set'} ${node.id} ` +
        `"${node.name}" comes from a library and is read-only here; document it in the file it is ` +
        'published from',
    );
  }
  return node;
};

interface Request {
  nodeId: string;
  description: DescriptionRequest;
  links: DocumentationLinkInfo[] | undefined;
  replaceFormatting: boolean;
}

const parse = (params: unknown): Request => {
  const p = (params ?? {}) as {
    nodeId?: unknown;
    description?: unknown;
    descriptionMarkdown?: unknown;
    documentationLinks?: unknown;
    replaceFormatting?: unknown;
  };
  if (typeof p.nodeId !== 'string') throw new TypeError(`${TOOL}: nodeId must be a string`);
  if (p.replaceFormatting !== undefined && typeof p.replaceFormatting !== 'boolean') {
    throw new TypeError(`${TOOL}: replaceFormatting must be a boolean`);
  }
  if (p.description !== undefined && typeof p.description !== 'string') {
    throw new TypeError(`${TOOL}: description must be a string`);
  }
  if (p.descriptionMarkdown !== undefined && typeof p.descriptionMarkdown !== 'string') {
    throw new TypeError(`${TOOL}: descriptionMarkdown must be a string`);
  }
  let links: DocumentationLinkInfo[] | undefined;
  if (p.documentationLinks !== undefined) {
    if (!Array.isArray(p.documentationLinks)) {
      throw new TypeError(`${TOOL}: documentationLinks must be an array of { uri }`);
    }
    // Figma's limit, checked here so a second link is refused before anything is written.
    if (p.documentationLinks.length > 1) {
      throw new TypeError(`${TOOL}: documentationLinks holds at most one link (Figma's limit)`);
    }
    links = p.documentationLinks.map((link, i) => {
      const uri = (link as { uri?: unknown } | null)?.uri;
      if (typeof uri !== 'string') {
        throw new TypeError(`${TOOL}: documentationLinks[${i}].uri must be a string`);
      }
      return { uri };
    });
  }
  if (p.description === undefined && p.descriptionMarkdown === undefined && links === undefined) {
    throw new TypeError(
      `${TOOL}: supply at least one of description / descriptionMarkdown / documentationLinks`,
    );
  }
  return {
    nodeId: p.nodeId,
    description: {
      ...(typeof p.description === 'string' ? { description: p.description } : {}),
      ...(typeof p.descriptionMarkdown === 'string' ? { markdown: p.descriptionMarkdown } : {}),
    },
    links,
    replaceFormatting: p.replaceFormatting === true,
  };
};

/**
 * Set a component's or component set's description and documentation link.
 *
 * The link is written first, being the one value Figma refuses on its content ("Documentation link
 * must be a URL"), so a bad link leaves the description untouched. Any failure after the first
 * write puts back what the call had changed, so the call lands whole or not at all — in Dev Mode
 * the first write is already refused, so there is nothing to put back.
 *
 * A plain description is refused when the one it would replace carries what plain text cannot —
 * formatting, a link, or the paragraph breaks of a description typed in Figma — and writing it
 * would change that markdown, unless the call says replaceFormatting. The case that decided it is
 * the ordinary read → edit → write: a description typed in Figma reads back with each paragraph
 * break as three newlines, Figma's plain setter takes those literally, and the description shows an
 * extra blank line between every paragraph (measured 2026-11-19 on a description typed in the
 * editor). The plain text alone cannot tell those three newlines from three a script wrote, so
 * nothing here can repair it by converting them; only the markdown knows, and the refusal points at
 * it. A plain write that leaves the markdown as it was (paragraphs sent with one blank line) goes
 * through.
 *
 * What did not land exactly as sent is reported in `adjusted`, never silently: Figma trims a plain
 * description's surrounding whitespace, stores line breaks as `\n`, drops everything from a NUL
 * character on and rewrites markdown into its own form (all measured).
 */
export const createSetComponentDocumentationHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const request = parse(params);
    const node = await resolveDocumentedComponent(figmaCtx, request.nodeId, TOOL);
    const before = snapshotDocumentation(node);
    const adjusted: string[] = [];

    try {
      if (request.links !== undefined) {
        node.documentationLinks = request.links.map(link => ({ uri: link.uri }));
        const stored = node.documentationLinks.map(link => link.uri);
        const sent = request.links.map(link => link.uri);
        if (stored.join('\n') !== sent.join('\n')) {
          adjusted.push(`documentationLinks were stored as ${JSON.stringify(stored)}`);
        }
      }

      const { description, markdown } = request.description;
      if (description !== undefined || markdown !== undefined) {
        if (!writeDescription(node, request.description)) {
          const readsAs = node.description;
          throw new Error(
            `${TOOL}: description and descriptionMarkdown disagree — that markdown reads as ` +
              `${quoteForMessage(readsAs)}, not ${quoteForMessage(description ?? '')}. Send ` +
              'one of them: description replaces the text with plain text, descriptionMarkdown ' +
              'keeps formatting.',
          );
        }
        if (
          markdown === undefined &&
          !request.replaceFormatting &&
          hasFormatting(before) &&
          node.descriptionMarkdown !== before.descriptionMarkdown
        ) {
          throw new Error(
            `${TOOL}: node ${node.id}'s description carries what plain text cannot — its markdown ` +
              `is ${quoteForMessage(before.descriptionMarkdown)} (formatting, a link, or paragraph ` +
              'breaks: a description typed in Figma reads back with each paragraph break as three ' +
              'newlines, and plain text sent with three adds a blank line) — and this plain text ' +
              `would make it ${quoteForMessage(node.descriptionMarkdown)}. Send ` +
              'descriptionMarkdown to keep it (get_local_components with documentation: true reads ' +
              'it), or pass replaceFormatting: true to replace it with plain text. Nothing was ' +
              'changed.',
          );
        }
        if (description !== undefined && node.description !== description) {
          adjusted.push(
            `description was stored as ${quoteForMessage(node.description)} (Figma trims ` +
              'surrounding whitespace, stores line breaks as \\n, replaces invalid characters and ' +
              'drops everything from a NUL character on)',
          );
        }
        if (markdown !== undefined && node.descriptionMarkdown !== markdown) {
          adjusted.push(
            `descriptionMarkdown was stored as ${quoteForMessage(node.descriptionMarkdown)} ` +
              '(Figma rewrites markdown into its own form)',
          );
        }
      }
    } catch (err) {
      try {
        restoreDocumentation(node, before);
      } catch {
        // The editor refused the write that failed (Dev Mode); it refuses this one too, and the
        // original error is the one that explains why.
      }
      throw err;
    }

    const result: ComponentDocumentationResult = { ok: true, nodeId: node.id };
    if (adjusted.length > 0) result.adjusted = adjusted.join('; ');
    return result;
  };
