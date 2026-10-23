import { describe, expect, it } from 'vitest';
import { computeLayout, splitItems, type LayoutInput, type LayoutItem, type Rect } from '../../client/src/lib/layout.ts';

function seats(rows: number, cols: number, overflow = 0): LayoutItem[] {
  const items: LayoutItem[] = [];
  for (let i = 0; i < rows * cols; i++) items.push({ key: `s${i}`, row: Math.floor(i / cols), col: i % cols });
  for (let k = 0; k < overflow; k++) items.push({ key: `o${k}`, row: rows + Math.floor(k / cols), col: k % cols });
  return items;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function check(input: LayoutInput) {
  const out = computeLayout(input);
  const rects = [...out.tiles.values()];
  expect(out.tiles.size).toBe(input.items.length);
  for (const r of rects) {
    expect(r.w).toBeGreaterThan(0);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(input.width + 1);
    expect(r.y + r.h).toBeLessThanOrEqual(input.height + 1);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
    if (out.stage) expect(overlaps(rects[i], out.stage)).toBe(false);
  }
  return out;
}

const base = { rows: 5, cols: 8, compact: false, split: null } as const;

describe('computeLayout', () => {
  it('lays out a full 40-seat class with no stage', () => {
    const out = check({ ...base, width: 1900, height: 980, items: seats(5, 8), stage: false, mode: 'sides' });
    expect(out.stage).toBeNull();
    // seat order: row A left to right
    const a1 = out.tiles.get('s0')!;
    const a2 = out.tiles.get('s1')!;
    const b1 = out.tiles.get('s8')!;
    expect(a2.x).toBeGreaterThan(a1.x);
    expect(b1.y).toBeGreaterThan(a1.y);
    expect(b1.x).toBe(a1.x);
  });

  it('keeps all 40 faces visible around a shared screen (sides)', () => {
    const out = check({ ...base, width: 1900, height: 980, items: seats(5, 8), stage: true, mode: 'sides' });
    expect(out.stage).not.toBeNull();
    expect(out.stage!.w).toBeGreaterThan(1900 * 0.5);
    // left half of the class goes left of the stage, right half to the right
    for (let i = 0; i < 40; i++) {
      const r = out.tiles.get(`s${i}`)!;
      if (i % 8 < 4) expect(r.x + r.w).toBeLessThanOrEqual(out.stage!.x);
      else expect(r.x).toBeGreaterThanOrEqual(out.stage!.x + out.stage!.w);
    }
    expect(out.tileWidth).toBeGreaterThan(90);
  });

  it('keeps all faces visible in stacked mode (front rows on top)', () => {
    const out = check({ ...base, width: 1900, height: 980, items: seats(5, 8), stage: true, mode: 'stacked' });
    const stage = out.stage!;
    for (let i = 0; i < 40; i++) {
      const r = out.tiles.get(`s${i}`)!;
      if (Math.floor(i / 8) < 3) expect(r.y + r.h).toBeLessThanOrEqual(stage.y);
      else expect(r.y).toBeGreaterThanOrEqual(stage.y + stage.h);
    }
  });

  it('handles overflow seats beyond the grid', () => {
    const items = seats(5, 8, 5);
    check({ ...base, width: 1900, height: 980, items, stage: false, mode: 'sides' });
    const out = check({ ...base, width: 1900, height: 980, items, stage: true, mode: 'sides' });
    expect(out.tiles.size).toBe(45);
  });

  it('respects a user split', () => {
    const narrow = check({ ...base, width: 1600, height: 900, items: seats(5, 8), stage: true, mode: 'sides', split: 0.1 });
    const wide = check({ ...base, width: 1600, height: 900, items: seats(5, 8), stage: true, mode: 'sides', split: 0.35 });
    expect(wide.stage!.w).toBeLessThan(narrow.stage!.w);
    expect(wide.tileWidth).toBeGreaterThan(narrow.tileWidth);
  });

  it('compact mode flows only the given items', () => {
    const items = [
      { key: 'a', row: 0, col: 3 },
      { key: 'b', row: 2, col: 1 },
      { key: 'c', row: 4, col: 7 },
    ];
    const out = check({ ...base, width: 1200, height: 700, items, stage: false, mode: 'sides', compact: true });
    expect(out.tiles.get('a')!.x).toBeLessThan(out.tiles.get('b')!.x);
  });

  it('works on a phone-sized portrait screen', () => {
    check({ ...base, width: 390, height: 700, items: seats(5, 8), stage: true, mode: 'stacked' });
    check({ ...base, width: 390, height: 700, items: seats(5, 8), stage: false, mode: 'stacked' });
  });

  it('survives degenerate sizes', () => {
    expect(computeLayout({ ...base, width: 0, height: 0, items: seats(5, 8), stage: true, mode: 'sides' }).tiles.size).toBe(0);
    const one = check({ ...base, rows: 1, cols: 1, width: 800, height: 600, items: seats(1, 1), stage: true, mode: 'sides' });
    expect(one.stage!.w).toBeGreaterThan(300);
  });

  it('splits odd column counts with the extra column on the left', () => {
    const [l, r] = splitItems({ ...base, cols: 5, rows: 2, width: 1, height: 1, items: seats(2, 5), stage: true, mode: 'sides' });
    expect(l.length).toBe(6);
    expect(r.length).toBe(4);
  });
});
