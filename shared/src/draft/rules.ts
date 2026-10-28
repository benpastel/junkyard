import type { Cell, Dir } from "../types.js";
import { MIN_PIECE_SQUARES, SHAPES, SHAPE_NAMES, transformCells, type ShapeName } from "./pieces.js";

export const cellKey = (x: number, y: number) => `${x},${y}`;
const key = cellKey;

/**
 * Returns null if `cells` can be placed onto a ship made of `existing` inside
 * `buildable`, else a short reason.
 */
export function placementError(
  buildable: ReadonlySet<string>,
  existing: readonly Cell[],
  cells: readonly Cell[],
): string | null {
  const occupied = new Set(existing.map((c) => key(c.x, c.y)));
  for (const c of cells) {
    if (!buildable.has(key(c.x, c.y))) return "Off the hull";
    if (occupied.has(key(c.x, c.y))) return "Overlaps";
  }
  const touches = cells.some((c) =>
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => occupied.has(key(c.x + dx!, c.y + dy!))),
  );
  return touches ? null : "Not attached";
}

export function buildableSet(hullRows: readonly string[]): Set<string> {
  const out = new Set<string>();
  hullRows.forEach((row, y) => [...row].forEach((ch, x) => ch !== "." && out.add(key(x, y))));
  return out;
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Empty hull squares that can never be filled: connected pockets smaller than the smallest piece.
 * (Any connected 4 squares is a tetromino, and every pocket borders the ship, so bigger pockets
 * can always take some piece.)
 */
export function deadSquares(buildable: ReadonlySet<string>, existing: readonly Cell[]): Set<string> {
  const occupied = new Set(existing.map((c) => key(c.x, c.y)));
  const seen = new Set<string>();
  const dead = new Set<string>();
  for (const start of buildable) {
    if (occupied.has(start) || seen.has(start)) continue;
    const pocket: string[] = [start];
    seen.add(start);
    for (let i = 0; i < pocket.length; i++) {
      const [x, y] = pocket[i]!.split(",").map(Number) as [number, number];
      for (const [dx, dy] of NEIGHBOURS) {
        const k = key(x + dx, y + dy);
        if (buildable.has(k) && !occupied.has(k) && !seen.has(k)) {
          seen.add(k);
          pocket.push(k);
        }
      }
    }
    if (pocket.length < MIN_PIECE_SQUARES) for (const k of pocket) dead.add(k);
  }
  return dead;
}

/** The shapes that can be placed somewhere on this ship right now (any turn or flip). */
export function fittingShapes(buildable: ReadonlySet<string>, existing: readonly Cell[]): ShapeName[] {
  const occupied = new Set(existing.map((c) => key(c.x, c.y)));
  // Anchor squares: empty buildable squares touching the ship. A placement must cover one.
  const anchors: [number, number][] = [];
  for (const k of buildable) {
    if (occupied.has(k)) continue;
    const [x, y] = k.split(",").map(Number) as [number, number];
    if (NEIGHBOURS.some(([dx, dy]) => occupied.has(key(x + dx, y + dy)))) anchors.push([x, y]);
  }
  const free = (x: number, y: number) => buildable.has(key(x, y)) && !occupied.has(key(x, y));
  return SHAPE_NAMES.filter((name) => {
    const base = (SHAPES[name] as readonly (readonly [number, number])[]).map(([x, y]) => ({ x, y, type: "hull" as const, dir: 0 as Dir }));
    for (const flip of [false, true]) {
      for (const rot of [0, 1, 2, 3] as Dir[]) {
        const shape = transformCells(base, rot, flip);
        // Line each of the shape's squares up with each anchor and see if it all lands on free squares.
        for (const [ax, ay] of anchors) {
          for (const s0 of shape) {
            if (shape.every((s) => free(ax + s.x - s0.x, ay + s.y - s0.y))) return true;
          }
        }
      }
    }
    return false;
  });
}