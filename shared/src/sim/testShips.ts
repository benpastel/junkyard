// Hand-made ships for tests and the arena sandbox.
import type { Cell, CellType, Dir } from "../types.js";

/**
 * Parse an ASCII ship. One character per cell:
 *   C core, # hull, M mirror edge up, A armor edge up
 *   engines (push direction): ^ > v <
 *   lasers (fire direction): i (up) } (right) ! (down) { (left)
 *   R saw pointing up, r saw pointing down, G grapple up, g grapple down
 *   . or space: empty
 */
export function parseShip(rows: string[]): Cell[] {
  const map: Record<string, [CellType, Dir]> = {
    C: ["core", 0],
    "#": ["hull", 0],
    M: ["mirror", 0],
    A: ["armor", 0],
    "^": ["engine", 0],
    ">": ["engine", 1],
    v: ["engine", 2],
    "<": ["engine", 3],
    i: ["laser", 0],
    "}": ["laser", 1],
    "!": ["laser", 2],
    "{": ["laser", 3],
    R: ["saw", 0],
    r: ["saw", 2],
    G: ["grapple", 0],
    g: ["grapple", 2],
  };
  const cells: Cell[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const m = map[ch];
      if (m) cells.push({ x, y, type: m[0], dir: m[1] });
    }),
  );
  return cells;
}

export const SANDBOX_SHIPS: { name: string; rows: string[] }[] = [
  {
    name: "Balanced",
    rows: [
      ".iMi.",
      ">###<",
      ".#C#.",
      ".###.",
      ".^#^.",
    ],
  },
  {
    name: "Lopsided",
    rows: [
      "i##.",
      "#C#<",
      "^#..",
      "^...",
    ],
  },
  {
    name: "Tiny",
    rows: [
      ">i<",
      ".C.",
      ".^.",
    ],
  },
  {
    name: "Brute",
    rows: [
      "RAGAR",
      ">###<",
      "##C##",
      "#####",
      "^^.^^",
    ],
  },
];
