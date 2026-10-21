// Rules about cells that the sim, the bots and both renderers must agree on.
import { DIR_VECTORS, type CellType, type Dir } from "./types.js";

/**
 * The direction a part needs a clear line in, or null if it works regardless.
 * Engines need their exhaust (opposite the push) clear; everything else needs its facing clear.
 * Mirrors and armor have no single facing: they work on whichever of their sides are exposed.
 */
export function workingDir(type: CellType, dir: Dir): Dir | null {
  switch (type) {
    case "engine":
      return ((dir + 2) % 4) as Dir;
    case "laser":
    case "grapple":
    case "saw":
      return dir;
    default:
      return null;
  }
}

/**
 * How many squares along its working direction a part needs clear. Lasers and grapples shoot,
 * so they need the whole line to the ship's edge (or they'd hit their own ship); engines and
 * saws just need the square next to them open.
 */
export function clearReach(type: CellType): number {
  return type === "laser" || type === "grapple" ? Infinity : 1;
}

/**
 * Extra squares (beyond the straight line) a part's overhang covers, as [forward, sideways]
 * offsets in the part's own frame. The saw blade is wide enough to reach the squares
 * diagonally in front, so those must be empty too.
 */
export function overhangSquares(type: CellType): readonly (readonly [number, number])[] {
  return type === "saw" ? SAW_SQUARES : NO_SQUARES;
}

const SAW_SQUARES = [
  [1, -1],
  [1, 1],
] as const;
const NO_SQUARES = [] as const;

/** Grid offset of [forward, sideways] in the frame of a part facing `w`. */
export function partOffset(w: Dir, forward: number, side: number): { x: number; y: number } {
  const f = DIR_VECTORS[w];
  const r = DIR_VECTORS[((w + 1) % 4) as Dir];
  return { x: f.x * forward + r.x * side, y: f.y * forward + r.y * side };
}

/**
 * Builds a checker for one ship (or one rigid body's worth of cells): a part is open when the
 * squares it needs in its working direction (see clearReach) hold none of the ship's own cells,
 * and nothing sits under the rest of its overhang (see overhangSquares). Covered parts do
 * nothing until whatever covers them is destroyed.
 */
export function openChecker(cells: readonly { x: number; y: number }[]) {
  const occupied = new Set(cells.map((c) => `${c.x},${c.y}`));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  return (c: { x: number; y: number; type: CellType; dir: Dir }): boolean => {
    const w = workingDir(c.type, c.dir);
    if (w === null) return true;
    const v = DIR_VECTORS[w];
    const reach = clearReach(c.type);
    for (let x = c.x + v.x, y = c.y + v.y, i = 0; i < reach && x >= minX && x <= maxX && y >= minY && y <= maxY; x += v.x, y += v.y, i++) {
      if (occupied.has(`${x},${y}`)) return false;
    }
    for (const [f, sd] of overhangSquares(c.type)) {
      const o = partOffset(w, f, sd);
      if (occupied.has(`${c.x + o.x},${c.y + o.y}`)) return false;
    }
    return true;
  };
}

/**
 * The cockpit: four core cells laid out like a keyboard's arrow keys, nose up.
 *   . U .
 *   L D R
 * Each cell's dir is the key it stands for. Offsets are from the "D" cell (the hull's 'C'),
 * which is also the ship's centre in the arena.
 */
export const COCKPIT_LAYOUT: readonly { dx: number; dy: number; dir: Dir }[] = [
  { dx: 0, dy: -1, dir: 0 },
  { dx: 1, dy: 0, dir: 1 },
  { dx: 0, dy: 0, dir: 2 },
  { dx: -1, dy: 0, dir: 3 },
];

/** The cockpit's core cells with its "D" cell at (x, y). */
export function cockpitCells(x: number, y: number): { x: number; y: number; type: CellType; dir: Dir }[] {
  return COCKPIT_LAYOUT.map((o) => ({ x: x + o.dx, y: y + o.dy, type: "core" as const, dir: o.dir }));
}
