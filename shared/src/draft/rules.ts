import type { Cell } from "../types.js";

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
