// Thrust allocation: which engines to fire, and how hard, for the keys being held.
//
// Each key asks for one component of the ship's push, in the ship's frame: up/down for its y,
// left/right for its x, rotate left/right for its spin. Every engine has a throttle from 0 to 1.
// The plan gets as much of what was asked for as it can while keeping everything nobody asked
// for at exactly zero (pressing up gives no spin and no sideways drift), partly firing engines
// where that balances. When nothing can be had that way (a lone off-centre engine), it fires
// anyway with as little of the unasked-for push as it can manage.
import { DIR_VECTORS, type Dir, type InputState } from "../types.js";

/** The keys that steer, as bits. */
export const KEY_BITS = { up: 1, right: 2, down: 4, left: 8, rotLeft: 16, rotRight: 32 } as const;

export function keyMask(input: InputState): number {
  let m = 0;
  for (const [k, bit] of Object.entries(KEY_BITS)) if (input[k as keyof typeof KEY_BITS]) m |= bit;
  return m;
}

export interface EngineArm {
  /** Position relative to the centre of mass, ship frame. */
  x: number;
  y: number;
  dir: Dir;
}

/** What one engine at full throttle does: push along x and y, and spin (positive turns the nose right). */
export function engineWrench(e: EngineArm): [number, number, number] {
  const d = DIR_VECTORS[e.dir];
  return [d.x, d.y, e.x * d.y - e.y * d.x];
}

/** A strict plan has to get at least this much of what was asked (in engines' worth) to be used. */
const STRICT_ENOUGH = 0.3;
/** Fallback: how much each unit of unasked-for push or spin costs against a unit of what was asked. */
const SLOPPY_COST = 0.5;

/**
 * Throttles (0..1, one per engine) for the held keys. Opposite keys held together cancel.
 * Spin is measured against the ship's longest engine lever, so a unit of it is as much as the
 * best-placed engine can turn the ship.
 */
export function planThrust(engines: readonly EngineArm[], mask: number): number[] {
  const n = engines.length;
  const none = new Array<number>(n).fill(0);
  if (!n) return none;
  const want = [axis(mask, KEY_BITS.right, KEY_BITS.left), axis(mask, KEY_BITS.down, KEY_BITS.up), axis(mask, KEY_BITS.rotRight, KEY_BITS.rotLeft)];
  if (want.every((w) => w === 0)) return none;

  const wrenches = engines.map(engineWrench);
  const reach = Math.max(1e-6, ...wrenches.map((w) => Math.abs(w[2])));
  for (const w of wrenches) w[2] /= reach;
  const asked = (u: number[]) => want.reduce((s, k, j) => s + k * wrenches.reduce((t, w, i) => t + w[j]! * u[i]!, 0), 0);
  const unasked = [0, 1, 2].filter((j) => want[j] === 0);
  const objective = wrenches.map((w) => want.reduce((s, k, j) => s + k * w[j]!, 0));

  // Strict: everything unasked held at zero.
  const strict = solveLP(
    objective,
    unasked.flatMap((j) => {
      const row = wrenches.map((w) => w[j]!);
      return [row, row.map((v) => -v)];
    }),
    n,
  );
  if (asked(strict) >= STRICT_ENOUGH) return strict;

  // Fallback: allow some, at a price. Each unasked component j is split as p_j - m_j, both >= 0,
  // and p_j + m_j (its size) is what's charged.
  const k = unasked.length;
  const obj = [...objective, ...new Array<number>(2 * k).fill(-SLOPPY_COST)];
  const rows = unasked.flatMap((j, q) => {
    const row = [...wrenches.map((w) => w[j]!), ...new Array<number>(2 * k).fill(0)];
    row[n + 2 * q] = -1;
    row[n + 2 * q + 1] = 1;
    return [row, row.map((v) => -v)];
  });
  const loose = solveLP(obj, rows, n).slice(0, n);
  return asked(loose) > asked(strict) ? loose : strict;
}

/**
 * The steering keys that would do anything (KEY_BITS): a direction needs an engine pushing that
 * way; a turn needs an engine off-centre enough to turn the ship that way.
 */
export function steerKeys(engines: readonly EngineArm[]): number {
  let m = 0;
  for (const e of engines) {
    m |= 1 << e.dir; // KEY_BITS' directions are 1 << dir
    const spin = engineWrench(e)[2];
    if (spin > 1e-3) m |= KEY_BITS.rotRight;
    if (spin < -1e-3) m |= KEY_BITS.rotLeft;
  }
  return m;
}

/** steerKeys for a ship given as cells (draft or arena), its centre taken as the middle of its cells. */
export function steerKeysOfCells<C extends { x: number; y: number; type: string; dir: Dir }>(cells: readonly C[], isOpen: (c: C) => boolean): number {
  if (!cells.length) return 0;
  const cx = cells.reduce((s, c) => s + c.x, 0) / cells.length;
  const cy = cells.reduce((s, c) => s + c.y, 0) / cells.length;
  return steerKeys(cells.filter((c) => c.type === "engine" && isOpen(c)).map((c) => ({ x: c.x - cx, y: c.y - cy, dir: c.dir })));
}

function axis(mask: number, plus: number, minus: number): number {
  return (mask & plus ? 1 : 0) - (mask & minus ? 1 : 0);
}

/**
 * Maximises c·x subject to A x <= 0 (each row of `rows`), 0 <= x, and x_i <= 1 for the first
 * `bounded` variables. The origin is always feasible, so one phase of the simplex method does;
 * Bland's rule keeps it from cycling on the many zero right-hand sides. Small problems only
 * (dozens of variables), and plans are cached, so a dense tableau is fine.
 */
export function solveLP(c: readonly number[], rows: readonly (readonly number[])[], bounded: number): number[] {
  const nv = c.length;
  const m = rows.length + bounded;
  const cols = nv + m + 1; // variables, one slack per row, right-hand side
  const t: Float64Array[] = [];
  for (let r = 0; r < m; r++) {
    const row = new Float64Array(cols);
    if (r < rows.length) for (let j = 0; j < nv; j++) row[j] = rows[r]![j]!;
    else {
      row[r - rows.length] = 1;
      row[cols - 1] = 1;
    }
    row[nv + r] = 1;
    t.push(row);
  }
  const z = new Float64Array(cols);
  for (let j = 0; j < nv; j++) z[j] = -c[j]!;
  const basis = Array.from({ length: m }, (_, r) => nv + r);
  const EPS = 1e-9;

  for (let iter = 0; iter < 500; iter++) {
    let enter = -1;
    for (let j = 0; j < cols - 1; j++) {
      if (z[j]! < -EPS) {
        enter = j;
        break;
      }
    }
    if (enter < 0) break;
    let leave = -1;
    let best = Infinity;
    for (let r = 0; r < m; r++) {
      const a = t[r]![enter]!;
      if (a <= EPS) continue;
      const ratio = t[r]![cols - 1]! / a;
      if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[r]! < basis[leave]!)) {
        best = ratio;
        leave = r;
      }
    }
    if (leave < 0) break; // unbounded: can't happen with every engine capped at 1
    const p = t[leave]!;
    const pv = p[enter]!;
    for (let j = 0; j < cols; j++) p[j] = p[j]! / pv;
    for (let r = 0; r < m; r++) {
      if (r === leave) continue;
      const row = t[r]!;
      const f = row[enter]!;
      if (f === 0) continue;
      for (let j = 0; j < cols; j++) row[j] = row[j]! - f * p[j]!;
    }
    const f = z[enter]!;
    for (let j = 0; j < cols; j++) z[j] = z[j]! - f * p[j]!;
    basis[leave] = enter;
  }

  const x = new Array<number>(nv).fill(0);
  for (let r = 0; r < m; r++) if (basis[r]! < nv) x[basis[r]!] = Math.max(0, Math.min(1, t[r]![cols - 1]!));
  return x;
}
