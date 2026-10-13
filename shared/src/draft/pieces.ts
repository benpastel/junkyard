import { DIR_VECTORS, type Cell, type CellType, type Dir } from "../types.js";
import type { Rng } from "../rng.js";

/** The 12 pentominoes, as (x, y) cells with y pointing down. */
export const PENTOMINOES = {
  F: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  I: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  L: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]],
  N: [[1, 0], [1, 1], [0, 2], [1, 2], [0, 3]],
  P: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],
  T: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  U: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  V: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  W: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]],
  X: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  Y: [[1, 0], [0, 1], [1, 1], [1, 2], [1, 3]],
  Z: [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;

export type PentominoName = keyof typeof PENTOMINOES;
export const PENTOMINO_NAMES = Object.keys(PENTOMINOES) as PentominoName[];

/** A draftable piece. `cells` are in the piece's base orientation, min x/y = 0. */
export interface Piece {
  id: string;
  shape: PentominoName;
  cells: Cell[];
}

/** Mirror across the vertical axis: right and left swap. */
export function flipDir(dir: Dir): Dir {
  return dir === 1 ? 3 : dir === 3 ? 1 : dir;
}

/**
 * Applies flip (mirror x) then `rot` clockwise quarter turns, and normalises
 * so the result's min x and min y are 0. Dirs are transformed to match.
 */
export function transformCells(cells: readonly Cell[], rot: Dir, flip: boolean): Cell[] {
  let out = cells.map((c) => (flip ? { ...c, x: -c.x, dir: flipDir(c.dir) } : { ...c }));
  for (let i = 0; i < rot; i++) {
    // Clockwise on screen with y down: (x, y) -> (-y, x). Up (0,-1) becomes right (1,0).
    out = out.map((c) => ({ ...c, x: -c.y, y: c.x, dir: ((c.dir + 1) % 4) as Dir }));
  }
  const minX = Math.min(...out.map((c) => c.x));
  const minY = Math.min(...out.map((c) => c.y));
  return out.map((c) => ({ ...c, x: c.x - minX, y: c.y - minY }));
}

/** The piece's cells in hull grid coordinates when its anchor (top-left) sits at (x, y). */
export function placedCells(piece: Piece, x: number, y: number, rot: Dir, flip: boolean): Cell[] {
  return transformCells(piece.cells, rot, flip).map((c) => ({ ...c, x: c.x + x, y: c.y + y }));
}

const SPECIAL_WEIGHTS: [CellType | null, number][] = [
  ["engine", 32],
  ["laser", 24],
  ["mirror", 7],
  ["armor", 7],
  ["ram", 10],
  ["grapple", 8],
  [null, 12],
];

function pickSpecial(rng: Rng): CellType | null {
  const total = SPECIAL_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [type, w] of SPECIAL_WEIGHTS) {
    r -= w;
    if (r < 0) return type;
  }
  return null;
}

const DIRS: Dir[] = [0, 1, 2, 3];

export function generatePiece(rng: Rng, id: string): Piece {
  const shape = rng.pick(PENTOMINO_NAMES);
  const coords = PENTOMINOES[shape];
  const cells: Cell[] = coords.map(([x, y]) => ({ x, y, type: "hull", dir: 0 }));
  const special = pickSpecial(rng);
  if (special === "mirror" || special === "armor") {
    // Shield pieces protect the same edge on every cell, so a whole side of the piece is covered.
    const dir = rng.pick(DIRS);
    return { id, shape, cells: cells.map((c) => ({ ...c, type: special, dir })) };
  }
  if (special) {
    const [index, dir] = pickSpecialSlot(cells, special, rng);
    cells[index] = { ...cells[index]!, type: special, dir };
  }
  return { id, shape, cells };
}

/** Chooses which cell carries the special part and which way it faces. */
function pickSpecialSlot(cells: Cell[], type: CellType, rng: Rng): [number, Dir] {
  const has = (x: number, y: number) => cells.some((c) => c.x === x && c.y === y);
  const open = (c: Cell, d: Dir) => !has(c.x + DIR_VECTORS[d].x, c.y + DIR_VECTORS[d].y);
  const opposite = (d: Dir) => ((d + 2) % 4) as Dir;

  const slots: [number, Dir][] = [];
  cells.forEach((c, i) => {
    const openDirs = DIRS.filter((d) => open(c, d));
    const isTip = openDirs.length === 3;
    for (const d of DIRS) {
      if (type === "laser" || type === "ram" || type === "grapple") {
        // Point outward along an arm: a tip cell, facing away from its one neighbour.
        if (isTip && open(c, d) && !open(c, opposite(d))) slots.push([i, d]);
      } else if (type === "engine") {
        // The nozzle (opposite of the push direction) must not be buried in the piece.
        if (!open(c, opposite(d))) continue;
        slots.push([i, d]);
        if (isTip) slots.push([i, d]);
      } else if (open(c, d)) {
        slots.push([i, d]);
      }
    }
  });
  return slots.length > 0 ? rng.pick(slots) : [0, 0];
}
