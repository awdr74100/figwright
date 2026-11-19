/**
 * Pages whose measurements behave as Figma's were measured to: ids minted per add, one axis per
 * measurement, no GROUP / SECTION / PAGE, nodes from the page itself, an INNER offset in -1…1, and
 * an id that is not on the page refused.
 */
export interface FakePage {
  id: string;
  name: string;
  type: 'PAGE';
  parent: null;
  loaded: boolean;
  /** Batch records every page's prototype flows before it runs. */
  flowStartingPoints: readonly unknown[];
  list: Measurement[];
  loadAsync(): Promise<void>;
  getMeasurements(): Measurement[];
  addMeasurement(
    start: { node: SceneNode; side: string },
    end: { node: SceneNode; side: string },
    opts?: { offset?: MeasurementOffset; freeText?: string },
  ): Measurement;
  editMeasurement(
    id: string,
    change: { offset?: MeasurementOffset; freeText?: string },
  ): Measurement;
  deleteMeasurement(id: string): void;
}

export const measuredPages = () => {
  let next = 0;
  const pages: FakePage[] = [];
  const axis = (s: string) => (s === 'LEFT' || s === 'RIGHT' ? 'x' : 'y');
  const makePage = (id: string, name: string): FakePage => {
    const page: FakePage = {
      id,
      name,
      type: 'PAGE',
      parent: null,
      loaded: id === '0:1',
      flowStartingPoints: [],
      list: [] as Measurement[],
      async loadAsync() {
        page.loaded = true;
      },
      getMeasurements() {
        if (!page.loaded) throw new Error('page not loaded');
        return page.list;
      },
      addMeasurement(
        start: { node: SceneNode; side: string },
        end: { node: SceneNode; side: string },
        opts: { offset?: MeasurementOffset; freeText?: string } = {},
      ) {
        if (axis(start.side) !== axis(end.side)) {
          throw new Error(
            `in addMeasurement: Measurement start side ${start.side} and end side ${end.side} must be on the same axis`,
          );
        }
        for (const n of [start.node, end.node]) {
          if (['GROUP', 'SECTION', 'PAGE'].includes(n.type))
            throw new Error(`in addMeasurement: Can't add measurement to a ${n.type} node`);
        }
        if (opts.offset?.type === 'INNER' && Math.abs(opts.offset.relative) > 1) {
          throw new Error(
            'in addMeasurement: Property "options" failed validation: Too big: expected number to be <=1 at .offset.relative',
          );
        }
        const m = {
          id: `9:${next++}`,
          start: { node: start.node, side: start.side },
          end: { node: end.node, side: end.side },
          offset: opts.offset ?? { type: 'INNER', relative: 0 },
          freeText: opts.freeText ?? '',
        } as Measurement;
        page.list.push(m);
        return m;
      },
      editMeasurement(mid: string, change: { offset?: MeasurementOffset; freeText?: string }) {
        const m = page.list.find(x => x.id === mid) as
          | { offset: MeasurementOffset; freeText: string }
          | undefined;
        if (m === undefined)
          throw new Error("in editMeasurement: Couldn't find measurement on the current page");
        if (change.offset !== undefined) m.offset = change.offset;
        if (change.freeText !== undefined) m.freeText = change.freeText;
        return m as unknown as Measurement;
      },
      deleteMeasurement(mid: string) {
        const i = page.list.findIndex(x => x.id === mid);
        if (i < 0)
          throw new Error("in deleteMeasurement: Couldn't find measurement on the current page");
        page.list.splice(i, 1);
      },
    };
    pages.push(page);
    return page;
  };
  const home = makePage('0:1', 'Home');
  const other = makePage('0:2', 'Other');
  const node = (id: string, page: { id: string }, type = 'RECTANGLE') =>
    ({ id, type, name: id, parent: page }) as unknown as SceneNode;
  const nodes = new Map<string, SceneNode>();
  for (const n of [
    node('1:1', home),
    node('1:2', home),
    node('1:3', home, 'GROUP'),
    node('2:1', other),
    node('2:2', other),
  ])
    nodes.set(n.id, n);
  const figmaCtx = {
    currentPage: home,
    root: { children: pages },
    getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null,
  } as unknown as typeof figma;
  return { figmaCtx, home, other, nodes };
};
