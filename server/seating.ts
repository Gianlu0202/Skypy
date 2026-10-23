// Seat assignment rules. Pure functions over plain data so they can be tested
// in isolation. Two layers of state:
//   • reservations — `seats[i] = memberId`, persisted; "this is Alice's seat"
//   • occupancy    — `session.seat`, live; "Alice's laptop is sitting in seat i"
// `rebalance` derives occupancy from reservations while moving as few people
// as possible, so faces never jump around unless they have to.

export interface Occupant {
  id: string;
  memberId: string;
  seat: number | null;
  joinedAt: number;
}

function byJoinOrder(a: Occupant, b: Occupant): number {
  return a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Place every live session in a seat.
 *  1. Members with a reservation sit in it (displacing temporary sitters).
 *  2. Everyone else keeps their current seat if it is still free.
 *  3. The rest take the first free unreserved seat, then the first seat whose
 *     owner is absent, and otherwise overflow (seat = null).
 */
export function rebalance(seats: readonly (string | null)[], sessions: Occupant[]): void {
  const cap = seats.length;
  const ordered = [...sessions].sort(byJoinOrder);
  const online = new Set(ordered.map((s) => s.memberId));
  const taken = new Map<number, Occupant>();
  const placed = new Map<Occupant, number>();

  for (let i = 0; i < cap; i++) {
    const owner = seats[i];
    if (!owner || !online.has(owner)) continue;
    const mine = ordered.filter((s) => s.memberId === owner && !placed.has(s));
    if (mine.length === 0) continue;
    const pick = mine.find((s) => s.seat === i) ?? mine[0];
    taken.set(i, pick);
    placed.set(pick, i);
  }

  for (const s of ordered) {
    if (placed.has(s)) continue;
    if (s.seat !== null && s.seat >= 0 && s.seat < cap && !taken.has(s.seat)) {
      taken.set(s.seat, s);
      placed.set(s, s.seat);
    }
  }

  for (const s of ordered) {
    if (placed.has(s)) continue;
    let seat = -1;
    for (let i = 0; i < cap; i++) {
      if (!taken.has(i) && seats[i] === null) {
        seat = i;
        break;
      }
    }
    if (seat < 0) {
      for (let i = 0; i < cap; i++) {
        const owner = seats[i];
        if (!taken.has(i) && owner !== null && !online.has(owner)) {
          seat = i;
          break;
        }
      }
    }
    if (seat >= 0) {
      taken.set(seat, s);
      placed.set(s, seat);
    }
  }

  for (const s of sessions) s.seat = placed.get(s) ?? null;
}

/**
 * Remember seats for people who don't have one yet: the seat they are
 * sitting in becomes theirs, as long as nobody else has reserved it.
 * Returns true when any reservation changed.
 */
export function claimSeats(seats: (string | null)[], sessions: Occupant[]): boolean {
  let changed = false;
  const reserved = new Set(seats.filter((m): m is string => m !== null));
  for (const s of [...sessions].sort(byJoinOrder)) {
    if (reserved.has(s.memberId)) continue;
    if (s.seat === null || s.seat >= seats.length || seats[s.seat] !== null) continue;
    seats[s.seat] = s.memberId;
    reserved.add(s.memberId);
    changed = true;
  }
  return changed;
}

/**
 * Give `memberId` the seat `target`. Whoever was reserved there swaps into
 * the member's previous seat (or, if the member had no reservation, the seat
 * they were sitting in, when that one is unreserved).
 */
export function assignSeat(seats: (string | null)[], sessions: readonly Occupant[], memberId: string, target: number): boolean {
  if (target < 0 || target >= seats.length) return false;
  const from = seats.indexOf(memberId);
  if (from === target) return false;
  const displaced = seats[target];
  seats[target] = memberId;
  if (from >= 0) {
    seats[from] = displaced;
  } else if (displaced !== null) {
    const sitting = sessions.find((s) => s.memberId === memberId && s.seat !== null);
    if (sitting && sitting.seat !== null && sitting.seat !== target && seats[sitting.seat] === null) {
      seats[sitting.seat] = displaced;
    }
  }
  return true;
}

/** Remove duplicate reservations and clamp the array to the room size. */
export function sanitizeSeats(seats: readonly (string | null)[], capacity: number, validMembers: ReadonlySet<string>): (string | null)[] {
  const out: (string | null)[] = new Array(capacity).fill(null);
  const seen = new Set<string>();
  for (let i = 0; i < capacity && i < seats.length; i++) {
    const m = seats[i];
    if (m && validMembers.has(m) && !seen.has(m)) {
      out[i] = m;
      seen.add(m);
    }
  }
  return out;
}

/**
 * Change the grid shape. Seats keep their (row, column) position; seats that
 * fall outside the new grid are moved into the first free seats, in order.
 * Returns the new reservation array and a function remapping old seat indices.
 */
export function resizeSeats(
  seats: readonly (string | null)[],
  oldCols: number,
  newRows: number,
  newCols: number,
): { seats: (string | null)[]; remap: (seat: number | null) => number | null } {
  const capacity = newRows * newCols;
  const out: (string | null)[] = new Array(capacity).fill(null);
  const remap = (seat: number | null): number | null => {
    if (seat === null || seat < 0) return null;
    const r = Math.floor(seat / oldCols);
    const c = seat % oldCols;
    return r < newRows && c < newCols ? r * newCols + c : null;
  };
  const homeless: string[] = [];
  seats.forEach((m, i) => {
    if (!m) return;
    const j = remap(i);
    if (j === null) homeless.push(m);
    else out[j] = m;
  });
  for (let i = 0; i < capacity && homeless.length > 0; i++) {
    if (out[i] === null) out[i] = homeless.shift()!;
  }
  return { seats: out, remap };
}
