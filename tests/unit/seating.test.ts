import { describe, expect, it } from 'vitest';
import { assignSeat, claimSeats, rebalance, resizeSeats, sanitizeSeats, type Occupant } from '../../server/seating.ts';

let clock = 0;
function session(memberId: string, seat: number | null = null, id = `${memberId}.t`): Occupant {
  return { id, memberId, seat, joinedAt: ++clock };
}

function seatsOf(sessions: Occupant[]): Record<string, number | null> {
  return Object.fromEntries(sessions.map((s) => [s.id, s.seat]));
}

describe('rebalance', () => {
  it('seats people in their reserved seat', () => {
    const seats = [null, 'bob', null, 'alice'];
    const s = [session('alice'), session('bob')];
    rebalance(seats, s);
    expect(seatsOf(s)).toEqual({ 'alice.t': 3, 'bob.t': 1 });
  });

  it('fills free unreserved seats first, in order', () => {
    const seats = ['absent', null, null, null];
    const s = [session('x'), session('y')];
    rebalance(seats, s);
    expect(seatsOf(s)).toEqual({ 'x.t': 1, 'y.t': 2 });
  });

  it('borrows an absent owner seat only when no free seat exists', () => {
    const seats = ['absent', 'other', null];
    const s = [session('x'), session('y'), session('z')];
    rebalance(seats, s);
    expect(seatsOf(s)).toEqual({ 'x.t': 2, 'y.t': 0, 'z.t': 1 });
  });

  it('overflows when every seat is taken', () => {
    const seats: (string | null)[] = [null, null];
    const s = [session('a'), session('b'), session('c')];
    rebalance(seats, s);
    expect(s.map((x) => x.seat)).toEqual([0, 1, null]);
  });

  it('owner arriving displaces a temporary sitter, who moves elsewhere', () => {
    const seats = ['owner', null, null];
    const temp = session('temp', 0);
    const other = session('other', 1);
    const owner = session('owner');
    const all = [temp, other, owner];
    rebalance(seats, all);
    expect(owner.seat).toBe(0);
    expect(other.seat).toBe(1);
    expect(temp.seat).toBe(2);
  });

  it('does not move anyone when an unrelated person leaves', () => {
    const seats: (string | null)[] = [null, null, null, null];
    const a = session('a');
    const b = session('b');
    const c = session('c');
    rebalance(seats, [a, b, c]);
    expect([a.seat, b.seat, c.seat]).toEqual([0, 1, 2]);
    rebalance(seats, [b, c]);
    expect([b.seat, c.seat]).toEqual([1, 2]);
  });

  it('moves the earliest overflow person into a freed seat', () => {
    const seats: (string | null)[] = [null, null];
    const a = session('a');
    const b = session('b');
    const c = session('c');
    const d = session('d');
    rebalance(seats, [a, b, c, d]);
    expect([c.seat, d.seat]).toEqual([null, null]);
    rebalance(seats, [b, c, d]);
    expect([b.seat, c.seat, d.seat]).toEqual([1, 0, null]);
  });

  it('gives a second device of the same member a different seat', () => {
    const seats = ['alice', null, null];
    const laptop = session('alice', null, 'alice.laptop');
    const phone = session('alice', null, 'alice.phone');
    rebalance(seats, [laptop, phone]);
    expect(laptop.seat).toBe(0);
    expect(phone.seat).toBe(1);
  });

  it('keeps the device already in the reserved seat there', () => {
    const seats = ['alice', null, null];
    const laptop = session('alice', 2, 'alice.laptop');
    const phone = session('alice', 0, 'alice.phone');
    rebalance(seats, [laptop, phone]);
    expect(phone.seat).toBe(0);
    expect(laptop.seat).toBe(2);
  });

  it('never seats two sessions in one seat and never exceeds capacity', () => {
    const seats: (string | null)[] = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? `m${i}` : null));
    const s = Array.from({ length: 55 }, (_, i) => session(`m${(i * 7) % 60}`, (i * 13) % 50, `s${i}`));
    rebalance(seats, s);
    const used = s.map((x) => x.seat).filter((x): x is number => x !== null);
    expect(new Set(used).size).toBe(used.length);
    expect(used.every((x) => x >= 0 && x < 40)).toBe(true);
    expect(used.length).toBe(40);
  });

  it('is idempotent', () => {
    const seats = ['a', null, 'c', null, 'e'];
    const s = [session('c'), session('x'), session('a'), session('y'), session('z'), session('w')];
    rebalance(seats, s);
    const first = seatsOf(s);
    rebalance(seats, s);
    expect(seatsOf(s)).toEqual(first);
  });
});

describe('claimSeats', () => {
  it('claims the seat a person sits in when unreserved', () => {
    const seats: (string | null)[] = [null, null, 'z'];
    const a = session('a', 1);
    const changed = claimSeats(seats, [a]);
    expect(changed).toBe(true);
    expect(seats).toEqual([null, 'a', 'z']);
  });

  it('does not claim reserved seats or claim twice', () => {
    const seats: (string | null)[] = ['owner', null, null];
    const temp = session('temp', 0);
    const laptop = session('m', 1, 'm.1');
    const phone = session('m', 2, 'm.2');
    claimSeats(seats, [temp, laptop, phone]);
    expect(seats).toEqual(['owner', 'm', null]);
  });

  it('ignores people who already have a seat', () => {
    const seats: (string | null)[] = ['a', null];
    const a = session('a', 1);
    expect(claimSeats(seats, [a])).toBe(false);
    expect(seats).toEqual(['a', null]);
  });
});

describe('assignSeat', () => {
  it('moves a member into an empty seat', () => {
    const seats = ['a', null, null];
    assignSeat(seats, [], 'a', 2);
    expect(seats).toEqual([null, null, 'a']);
  });

  it('swaps two reserved members', () => {
    const seats = ['a', null, 'b'];
    assignSeat(seats, [], 'a', 2);
    expect(seats).toEqual(['b', null, 'a']);
  });

  it('gives the displaced member the seat the mover was sitting in', () => {
    const seats = [null, null, 'b'];
    const mover = session('a', 0);
    assignSeat(seats, [mover], 'a', 2);
    expect(seats).toEqual(['b', null, 'a']);
  });

  it('displaced member loses reservation if mover sat in someone else’s seat', () => {
    const seats = ['owner', null, 'b'];
    const mover = session('a', 0);
    assignSeat(seats, [mover], 'a', 2);
    expect(seats).toEqual(['owner', null, 'a']);
  });

  it('ignores out of range seats', () => {
    const seats = ['a', null];
    expect(assignSeat(seats, [], 'a', 5)).toBe(false);
    expect(seats).toEqual(['a', null]);
  });

  it('followed by rebalance, faces actually swap', () => {
    const seats = ['a', 'b', null];
    const a = session('a');
    const b = session('b');
    rebalance(seats, [a, b]);
    expect([a.seat, b.seat]).toEqual([0, 1]);
    assignSeat(seats, [a, b], 'a', 1);
    rebalance(seats, [a, b]);
    expect([a.seat, b.seat]).toEqual([1, 0]);
  });
});

describe('resizeSeats', () => {
  it('keeps row/column positions when adding a column', () => {
    // 2x2 → 2x3
    const { seats, remap } = resizeSeats(['a', 'b', 'c', 'd'], 2, 2, 3);
    expect(seats).toEqual(['a', 'b', null, 'c', 'd', null]);
    expect(remap(3)).toBe(4);
  });

  it('rehomes reservations that fall off the grid', () => {
    // 2x3 → 2x2: column 3 disappears
    const { seats, remap } = resizeSeats(['a', 'b', 'x', 'c', null, 'y'], 3, 2, 2);
    expect(seats).toEqual(['a', 'b', 'c', 'x']);
    expect(remap(2)).toBe(null);
    expect(remap(3)).toBe(2);
  });

  it('drops reservations when the room is simply too small', () => {
    const { seats } = resizeSeats(['a', 'b', 'c', 'd'], 2, 1, 2);
    expect(seats).toEqual(['a', 'b']);
  });
});

describe('sanitizeSeats', () => {
  it('removes duplicates, unknown members and clamps size', () => {
    const out = sanitizeSeats(['a', 'a', 'ghost', 'b', 'c'], 4, new Set(['a', 'b', 'c']));
    expect(out).toEqual(['a', null, null, 'b']);
  });
});
