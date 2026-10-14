// Rules about cells that the sim, the bots and both renderers must agree on.
import { DIR_VECTORS, type CellType, type Dir } from "./types.js";

/**
 * The direction a part needs a clear line in, or null if it works regardless.
 * Engines need their exhaust (opposite the push) clear; everything else needs its facing clear.
 * Mirrors have no single facing: they reflect off whichever of their sides are exposed.
 */
export function workingDir(type: CellType, dir: Dir): Dir | null {
  switch (type) {
    case "engine":
      return ((dir + 2) % 4) as Dir;
    case "laser":
    case "grapple":
    case "saw":
    case "armor":
      return dir;
    default:
      return null;
  }
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
 * straight grid line from it, in its working direction, contains none of the ship's own cells,
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
    for (let x = c.x + v.x, y = c.y + v.y; x >= minX && x <= maxX && y >= minY && y <= maxY; x += v.x, y += v.y) {
      if (occupied.has(`${x},${y}`)) return false;
    }
    for (const [f, sd] of overhangSquares(c.type)) {
      const o = partOffset(w, f, sd);
      if (occupied.has(`${c.x + o.x},${c.y + o.y}`)) return false;
    }
    return true;
  };
}
