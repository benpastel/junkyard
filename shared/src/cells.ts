// Rules about cells that the sim, the bots and both renderers must agree on.
import { DIR_VECTORS, type CellType, type Dir } from "./types.js";

/**
 * The direction a part needs a clear line in, or null if it works regardless.
 * Engines need their exhaust (opposite the push) clear; everything else needs its facing clear.
 */
export function workingDir(type: CellType, dir: Dir): Dir | null {
  switch (type) {
    case "engine":
      return ((dir + 2) % 4) as Dir;
    case "laser":
    case "grapple":
    case "ram":
    case "mirror":
    case "armor":
      return dir;
    default:
      return null;
  }
}

/**
 * Builds a checker for one ship (or one rigid body's worth of cells): a part is open when the
 * straight grid line from it, in its working direction, contains none of the ship's own cells.
 * Covered parts do nothing until whatever covers them is destroyed.
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
    return true;
  };
}
