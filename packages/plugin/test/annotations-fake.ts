import { type AnnotatableNode } from '../src/annotations.js';
import { plainToMarkdown } from '../src/documentation.js';

/**
 * A node whose annotations behave as Figma's were measured to: one of label / labelMarkdown per
 * write, a plain label trimmed with its markdown escaped, markdown kept and its plain text derived
 * (a paragraph break read back as three newlines), no content refused, a pinned property refused
 * unless the node has it.
 */
export const annotatedNode = (
  has: readonly string[] = ['width', 'height', 'fills'],
): AnnotatableNode => {
  let stored: Annotation[] = [];
  const node = {
    id: '1:1',
    type: 'FRAME',
    get annotations(): ReadonlyArray<Annotation> {
      return stored;
    },
    set annotations(list: ReadonlyArray<Annotation>) {
      stored = list.map((a, i) => {
        if (a.label !== undefined && a.labelMarkdown !== undefined) {
          throw new Error(
            'in set_annotations: Property "annotations" failed validation: Only one of label or labelMarkdown should be given. at index ' +
              i,
          );
        }
        if ((a.label ?? a.labelMarkdown ?? '') === '' && (a.properties ?? []).length === 0) {
          throw new Error(
            'in set_annotations: Setting an annotation with no content is invalid, set the annotations field to [] instead',
          );
        }
        for (const p of a.properties ?? []) {
          if (!has.includes(p.type)) {
            throw new Error(`in set_annotations: Invalid property "${p.type}" for a FRAME node`);
          }
        }
        const out: {
          label?: string;
          labelMarkdown?: string;
          categoryId?: string;
          properties?: AnnotationProperty[];
        } = {};
        if (a.label !== undefined) {
          out.label = a.label.replace(/\r\n?/g, '\n').trim();
          out.labelMarkdown = plainToMarkdown(out.label);
        } else if (a.labelMarkdown !== undefined) {
          out.labelMarkdown = a.labelMarkdown.replace(/_([^_]+)_/g, '*$1*');
          out.label = out.labelMarkdown.replace(/[*_]/g, '').replace(/\n\n/g, '\n\n\n');
        }
        if (a.categoryId !== undefined) out.categoryId = a.categoryId;
        if (a.properties !== undefined) out.properties = a.properties.map(p => ({ type: p.type }));
        return out as Annotation;
      });
    },
  };
  return node as unknown as AnnotatableNode;
};
