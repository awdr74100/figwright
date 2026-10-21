/**
 * SVG path data → the dialect Figma's vectorPaths accepts: absolute M, L, C, Q and Z, every number
 * separated by a space. Figma refuses the rest of the SVG grammar outright — relative commands, H /
 * V, S / T, arcs, and even commas or numbers run together as minified icon sets write them — so
 * this rewrites any valid path into the same geometry in that dialect: H / V become lines, S / T
 * spell out their reflected handle, arcs become cubic Béziers (at most a quarter turn each).
 */

const ARG_COUNT: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/** Past this a number prints in exponent form, which Figma does not read; no drawing is that big. */
const LIMIT = 1e15;

/** Six decimals: far below a pixel, and never the exponent form Figma would not read. */
const fmt = (v: number): string => {
  if (!(Math.abs(v) < LIMIT)) throw new RangeError(`coordinate ${v} is out of range`);
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? '0' : String(r);
};

class Scanner {
  private i = 0;

  private readonly s: string;

  constructor(s: string) {
    this.s = s;
  }

  /** Whitespace and at most one comma, as the grammar allows between numbers. */
  private skip(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }

  private skipSeparator(): void {
    this.skip();
    if (this.s[this.i] === ',') {
      this.i++;
      this.skip();
    }
  }

  done(): boolean {
    this.skip();
    return this.i >= this.s.length;
  }

  /** The next command letter, consumed — or null when a number follows (an implicit repeat). */
  command(): string | null {
    this.skip();
    const c = this.s[this.i];
    if (c !== undefined && /[MLHVCSQTAZ]/i.test(c)) {
      this.i++;
      return c;
    }
    return null;
  }

  number(): number {
    this.skipSeparator();
    const m = NUMBER.exec(this.s.slice(this.i));
    if (m === null) throw this.error('a number');
    this.i += m[0].length;
    return Number(m[0]);
  }

  /** An arc flag: a single 0 or 1, which minified paths run straight into the next number. */
  flag(): number {
    this.skipSeparator();
    const c = this.s[this.i];
    if (c !== '0' && c !== '1') throw this.error('an arc flag (0 or 1)');
    this.i++;
    return c === '1' ? 1 : 0;
  }

  error(expected: string): SyntaxError {
    const near = this.s.slice(this.i, this.i + 12);
    return new SyntaxError(
      `expected ${expected} at character ${this.i}${near === '' ? ' (end of data)' : ` ("${near}")`}`,
    );
  }
}

type Cubic = [number, number, number, number, number, number];

/** The signed angle from vector u to vector v. */
const angleOf = (ux: number, uy: number, vx: number, vy: number): number =>
  Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);

/**
 * An SVG arc (endpoint form, SVG 1.1 §F.6.5) as cubic Béziers of at most 90° each. Radii too small
 * to reach the end point are scaled up, a zero radius draws a line, as the SVG spec prescribes.
 */
const arcToCubics = (
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  angle: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
): Cubic[] | 'line' | 'none' => {
  if (x1 === x2 && y1 === y2) return 'none';
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return 'line';
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const theta1 = angleOf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angleOf((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
  if (sweep === 1 && delta < 0) delta += 2 * Math.PI;
  const parts = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / parts;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t: number): [number, number] => [
    cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  ];
  const derivative = (t: number): [number, number] => [
    -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  ];
  const out: Cubic[] = [];
  for (let i = 0; i < parts; i++) {
    const a = theta1 + i * step;
    const b = a + step;
    const [ax, ay] = point(a);
    const [bx, by] = i === parts - 1 ? [x2, y2] : point(b);
    const [dax, day] = derivative(a);
    const [dbx, dby] = derivative(b);
    out.push([ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by]);
  }
  return out;
};

/** Rewrite SVG path data into Figma's dialect; throws a SyntaxError naming where it went wrong. */
export const toFigmaPathData = (data: string): string => {
  const scan = new Scanner(data);
  const out: string[] = [];
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  // The previous segment's second handle, for S (after C / S) and T (after Q / T).
  let cubicHandle: [number, number] | null = null;
  let quadHandle: [number, number] | null = null;
  let command: string | null = null;
  let open = false;
  const emit = (op: string, ...nums: number[]): void => {
    out.push(nums.length === 0 ? op : `${op} ${nums.map(fmt).join(' ')}`);
  };
  /** A drawing command right after Z (or at the very start) begins a new subpath where it is. */
  const ensureOpen = (): void => {
    if (!open) {
      emit('M', cx, cy);
      open = true;
    }
  };
  while (!scan.done()) {
    const letter = scan.command();
    if (command === null && letter !== 'M' && letter !== 'm') {
      throw new SyntaxError(`a path starts with M, not ${letter === null ? 'a number' : letter}`);
    }
    if (letter !== null) command = letter;
    else if (command === 'Z' || command === 'z') throw scan.error('a command after Z');
    const cmd: string = command!;
    const upper: string = cmd.toUpperCase();
    const rel: boolean = cmd !== upper;
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    const args: number[] = [];
    for (let i = 0; i < ARG_COUNT[upper]!; i++) {
      args.push(upper === 'A' && (i === 3 || i === 4) ? scan.flag() : scan.number());
    }
    let nextCubic: [number, number] | null = null;
    let nextQuad: [number, number] | null = null;
    switch (upper) {
      case 'M': {
        cx = ox + args[0]!;
        cy = oy + args[1]!;
        startX = cx;
        startY = cy;
        emit('M', cx, cy);
        open = true;
        // Pairs after a moveto are implicit linetos.
        command = rel ? 'l' : 'L';
        break;
      }
      case 'L':
      case 'H':
      case 'V': {
        ensureOpen();
        if (upper === 'L') {
          cx = ox + args[0]!;
          cy = oy + args[1]!;
        } else if (upper === 'H') cx = ox + args[0]!;
        else cy = oy + args[0]!;
        emit('L', cx, cy);
        break;
      }
      case 'C':
      case 'S': {
        ensureOpen();
        let x1: number;
        let y1: number;
        let rest: number[];
        if (upper === 'C') {
          x1 = ox + args[0]!;
          y1 = oy + args[1]!;
          rest = args.slice(2);
        } else {
          [x1, y1] =
            cubicHandle === null ? [cx, cy] : [2 * cx - cubicHandle[0], 2 * cy - cubicHandle[1]];
          rest = args;
        }
        const x2 = ox + rest[0]!;
        const y2 = oy + rest[1]!;
        cx = ox + rest[2]!;
        cy = oy + rest[3]!;
        emit('C', x1, y1, x2, y2, cx, cy);
        nextCubic = [x2, y2];
        break;
      }
      case 'Q':
      case 'T': {
        ensureOpen();
        let x1: number;
        let y1: number;
        if (upper === 'Q') {
          x1 = ox + args[0]!;
          y1 = oy + args[1]!;
          cx = ox + args[2]!;
          cy = oy + args[3]!;
        } else {
          [x1, y1] =
            quadHandle === null ? [cx, cy] : [2 * cx - quadHandle[0], 2 * cy - quadHandle[1]];
          cx = ox + args[0]!;
          cy = oy + args[1]!;
        }
        emit('Q', x1, y1, cx, cy);
        nextQuad = [x1, y1];
        break;
      }
      case 'A': {
        ensureOpen();
        const x = ox + args[5]!;
        const y = oy + args[6]!;
        const arc = arcToCubics(cx, cy, args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, x, y);
        if (arc === 'line') emit('L', x, y);
        else if (arc !== 'none') for (const c of arc) emit('C', ...c);
        cx = x;
        cy = y;
        break;
      }
      default: {
        // Z: back to where the subpath began.
        if (open) emit('Z');
        cx = startX;
        cy = startY;
        open = false;
      }
    }
    cubicHandle = nextCubic;
    quadHandle = nextQuad;
  }
  if (out.length === 0) throw new SyntaxError('no path commands');
  return out.join(' ');
};
