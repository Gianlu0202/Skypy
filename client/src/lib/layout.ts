// Layout engine: turns the classroom seat grid into on-screen rectangles.
//
//  • Gallery — the seat grid as-is (row A at the top), tiles fill the space.
//  • Sides   — a shared screen takes the middle; the left half of the class
//              slides to a left column block, the right half to the right.
//  • Stacked — the front rows go above the shared screen, back rows below.
//
// Every item keeps a stable key so tiles can glide between arrangements.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutItem {
  key: string;
  /** Classroom row (0 = front). Overflow items use rows ≥ the grid's rows. */
  row: number;
  col: number;
}

export type StageMode = 'sides' | 'stacked';

export interface LayoutInput {
  width: number;
  height: number;
  rows: number;
  cols: number;
  items: LayoutItem[];
  /** Flow items in order instead of pinning them to their grid cell. */
  compact: boolean;
  stage: boolean;
  mode: StageMode;
  /** User-chosen share of the screen for faces (0–1), null = automatic. */
  split: number | null;
}

export interface LayoutResult {
  tiles: Map<string, Rect>;
  stage: Rect | null;
  /** Drag handles between faces and the stage. */
  handles: Rect[];
  /** Typical tile width, used to pick label density. */
  tileWidth: number;
}

export const PAD = 12;
const GAP_GALLERY = 10;
const GAP_SIDE = 6;
const STAGE_GAP = 12;
const WIDE = 16 / 9;
const STANDARD = 4 / 3;

export const SPLIT_MIN = 0.06;
export const SPLIT_MAX = 0.42;

/** Largest rectangle with aspect in [minA, maxA] that fits in cw × ch. */
function fit(cw: number, ch: number, minA: number, maxA: number): { w: number; h: number } {
  if (cw <= 0 || ch <= 0) return { w: 0, h: 0 };
  const a = cw / ch;
  if (a > maxA) return { w: ch * maxA, h: ch };
  if (a < minA) return { w: cw, h: cw / minA };
  return { w: cw, h: ch };
}

interface Grid {
  cols: number;
  rows: number;
  w: number;
  h: number;
}

/** Choose the column count that gives the biggest tiles for n items in a box. */
export function bestGrid(n: number, boxW: number, boxH: number, gap: number, minA: number, maxA: number): Grid {
  let best: Grid = { cols: 1, rows: Math.max(1, n), w: 0, h: 0 };
  for (let c = 1; c <= Math.max(1, n); c++) {
    const r = Math.ceil(n / c);
    const cw = (boxW - (c - 1) * gap) / c;
    const ch = (boxH - (r - 1) * gap) / r;
    const t = fit(cw, ch, minA, maxA);
    if (t.w * t.h > best.w * best.h + 0.5) best = { cols: c, rows: r, w: t.w, h: t.h };
  }
  return best;
}

/** Grid with a fixed column count (for the full seat chart). */
function fixedGrid(cols: number, rows: number, boxW: number, boxH: number, gap: number, minA: number, maxA: number): Grid {
  const cw = (boxW - (cols - 1) * gap) / cols;
  const ch = (boxH - (rows - 1) * gap) / rows;
  const t = fit(cw, ch, minA, maxA);
  return { cols, rows, w: t.w, h: t.h };
}

function place(
  out: Map<string, Rect>,
  items: LayoutItem[],
  grid: Grid,
  box: Rect,
  gap: number,
  cellOf: (item: LayoutItem, index: number) => { r: number; c: number },
  centerLastRow: boolean,
): void {
  const blockW = grid.cols * grid.w + (grid.cols - 1) * gap;
  const blockH = grid.rows * grid.h + (grid.rows - 1) * gap;
  const x0 = box.x + (box.w - blockW) / 2;
  const y0 = box.y + (box.h - blockH) / 2;
  const lastRow = grid.rows - 1;
  const inLast = items.length - lastRow * grid.cols;
  const lastShift = centerLastRow && inLast > 0 && inLast < grid.cols ? ((grid.cols - inLast) * (grid.w + gap)) / 2 : 0;
  items.forEach((item, i) => {
    const { r, c } = cellOf(item, i);
    out.set(item.key, {
      x: Math.round(x0 + c * (grid.w + gap) + (r === lastRow ? lastShift : 0)),
      y: Math.round(y0 + r * (grid.h + gap)),
      w: Math.round(grid.w),
      h: Math.round(grid.h),
    });
  });
}

function byGridOrder(a: LayoutItem, b: LayoutItem): number {
  return a.row - b.row || a.col - b.col;
}

function gallery(input: LayoutInput): LayoutResult {
  const tiles = new Map<string, Rect>();
  const box: Rect = { x: PAD, y: PAD, w: input.width - 2 * PAD, h: input.height - 2 * PAD };
  const items = [...input.items].sort(byGridOrder);
  if (items.length === 0) return { tiles, stage: null, handles: [], tileWidth: 0 };

  if (input.compact) {
    const grid = bestGrid(items.length, box.w, box.h, GAP_GALLERY, STANDARD, WIDE);
    place(tiles, items, grid, box, GAP_GALLERY, (_, i) => ({ r: Math.floor(i / grid.cols), c: i % grid.cols }), true);
    return { tiles, stage: null, handles: [], tileWidth: grid.w };
  }

  const rows = Math.max(input.rows, ...items.map((i) => i.row + 1));
  const grid = fixedGrid(input.cols, rows, box.w, box.h, GAP_GALLERY, STANDARD, WIDE);
  place(tiles, items, grid, box, GAP_GALLERY, (item) => ({ r: item.row, c: item.col }), false);
  return { tiles, stage: null, handles: [], tileWidth: grid.w };
}

/** Split the class: left/right halves (sides) or front/back halves (stacked). */
export function splitItems(input: LayoutInput): [LayoutItem[], LayoutItem[]] {
  const a: LayoutItem[] = [];
  const b: LayoutItem[] = [];
  const overflow: LayoutItem[] = [];
  const halfCols = Math.ceil(input.cols / 2);
  const halfRows = Math.ceil(input.rows / 2);
  for (const item of [...input.items].sort(byGridOrder)) {
    if (item.row >= input.rows) overflow.push(item);
    else if (input.mode === 'sides' ? item.col < halfCols : item.row < halfRows) a.push(item);
    else b.push(item);
  }
  for (const item of overflow) (a.length <= b.length ? a : b).push(item);
  return [a, b];
}

function sides(input: LayoutInput): LayoutResult {
  const tiles = new Map<string, Rect>();
  const [left, right] = splitItems(input);
  const W = input.width - 2 * PAD;
  const H = input.height - 2 * PAD;
  const n = Math.max(left.length, right.length);

  let panelW: number;
  if (input.split !== null) {
    panelW = clamp(input.split, SPLIT_MIN, SPLIT_MAX) * input.width;
  } else {
    // Let the shared screen have its natural 16:9 width, within 50–70% of the view.
    const stageTarget = clamp(H * WIDE, 0.5 * W, 0.7 * W);
    panelW = Math.max(64, (W - stageTarget - 2 * STAGE_GAP) / 2);
  }
  const fitPanel = (count: number): Grid =>
    count === 0 ? { cols: 0, rows: 0, w: 0, h: 0 } : bestGrid(count, panelW, H, GAP_SIDE, 1, STANDARD);
  // Same tile size on both sides so the class looks even.
  const ref = fitPanel(n);
  const gridFor = (count: number): Grid => {
    if (count === 0) return { cols: 0, rows: 0, w: 0, h: 0 };
    const cols = Math.min(ref.cols, count);
    return { cols, rows: Math.ceil(count / cols), w: ref.w, h: ref.h };
  };
  const lg = gridFor(left.length);
  const rg = gridFor(right.length);
  const blockW = (g: Grid) => (g.cols === 0 ? 0 : g.cols * g.w + (g.cols - 1) * GAP_SIDE);
  const lw = blockW(lg);
  const rw = blockW(rg);
  const lBox: Rect = { x: PAD, y: PAD, w: lw, h: H };
  const rBox: Rect = { x: PAD + W - rw, y: PAD, w: rw, h: H };
  const stageX = PAD + (lw > 0 ? lw + STAGE_GAP : 0);
  const stageR = PAD + W - (rw > 0 ? rw + STAGE_GAP : 0);
  const stage: Rect = { x: stageX, y: PAD, w: Math.max(0, stageR - stageX), h: H };

  const cell = (g: Grid) => (_: LayoutItem, i: number) => ({ r: Math.floor(i / g.cols), c: i % g.cols });
  if (left.length) place(tiles, left, lg, lBox, GAP_SIDE, cell(lg), false);
  if (right.length) place(tiles, right, rg, rBox, GAP_SIDE, cell(rg), false);

  const handles: Rect[] = [];
  if (lw > 0) handles.push({ x: stageX - STAGE_GAP, y: PAD, w: STAGE_GAP, h: H });
  if (rw > 0) handles.push({ x: stageR, y: PAD, w: STAGE_GAP, h: H });
  return { tiles, stage, handles, tileWidth: ref.w };
}

function stacked(input: LayoutInput): LayoutResult {
  const tiles = new Map<string, Rect>();
  const [top, bottom] = splitItems(input);
  const W = input.width - 2 * PAD;
  const H = input.height - 2 * PAD;
  const n = Math.max(top.length, bottom.length);

  let bandH: number;
  if (input.split !== null) {
    bandH = clamp(input.split, SPLIT_MIN, SPLIT_MAX) * input.height;
  } else {
    const stageTarget = clamp(W / WIDE, 0.5 * H, 0.7 * H);
    bandH = Math.max(48, (H - stageTarget - 2 * STAGE_GAP) / 2);
  }
  // Rows of faces: transpose the column search (few rows, many columns).
  const bandGrid = (count: number): Grid => {
    if (count === 0) return { cols: 0, rows: 0, w: 0, h: 0 };
    let best: Grid = { cols: count, rows: 1, w: 0, h: 0 };
    for (let r = 1; r <= count; r++) {
      const c = Math.ceil(count / r);
      const cw = (W - (c - 1) * GAP_SIDE) / c;
      const ch = (bandH - (r - 1) * GAP_SIDE) / r;
      const t = fit(cw, ch, STANDARD, WIDE);
      if (t.w * t.h > best.w * best.h + 0.5) best = { cols: c, rows: r, w: t.w, h: t.h };
    }
    return best;
  };
  const ref = bandGrid(n);
  const gridFor = (count: number): Grid => {
    if (count === 0) return { cols: 0, rows: 0, w: 0, h: 0 };
    const cols = Math.min(ref.cols, count);
    return { cols, rows: Math.ceil(count / cols), w: ref.w, h: ref.h };
  };
  const tg = gridFor(top.length);
  const bg = gridFor(bottom.length);
  const blockH = (g: Grid) => (g.rows === 0 ? 0 : g.rows * g.h + (g.rows - 1) * GAP_SIDE);
  const th = blockH(tg);
  const bh = blockH(bg);
  const tBox: Rect = { x: PAD, y: PAD, w: W, h: th };
  const bBox: Rect = { x: PAD, y: PAD + H - bh, w: W, h: bh };
  const stageY = PAD + (th > 0 ? th + STAGE_GAP : 0);
  const stageB = PAD + H - (bh > 0 ? bh + STAGE_GAP : 0);
  const stage: Rect = { x: PAD, y: stageY, w: W, h: Math.max(0, stageB - stageY) };

  const cell = (g: Grid) => (_: LayoutItem, i: number) => ({ r: Math.floor(i / g.cols), c: i % g.cols });
  if (top.length) place(tiles, top, tg, tBox, GAP_SIDE, cell(tg), true);
  if (bottom.length) place(tiles, bottom, bg, bBox, GAP_SIDE, cell(bg), true);

  const handles: Rect[] = [];
  if (th > 0) handles.push({ x: PAD, y: stageY - STAGE_GAP, w: W, h: STAGE_GAP });
  if (bh > 0) handles.push({ x: PAD, y: stageB, w: W, h: STAGE_GAP });
  return { tiles, stage, handles, tileWidth: ref.w };
}

export function computeLayout(input: LayoutInput): LayoutResult {
  if (input.width < 2 * PAD + 20 || input.height < 2 * PAD + 20) {
    return { tiles: new Map(), stage: null, handles: [], tileWidth: 0 };
  }
  if (!input.stage) return gallery(input);
  if (input.items.length === 0) {
    return {
      tiles: new Map(),
      stage: { x: PAD, y: PAD, w: input.width - 2 * PAD, h: input.height - 2 * PAD },
      handles: [],
      tileWidth: 0,
    };
  }
  return input.mode === 'sides' ? sides(input) : stacked(input);
}

/** Pick sides vs stacked for "auto" from the viewport shape. */
export function autoMode(width: number, height: number): StageMode {
  return width / Math.max(1, height) >= 1.15 ? 'sides' : 'stacked';
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
