import { DIR_VECTORS, type Cell, type CellType, type Dir } from "../types.js";
import type { Rng } from "../rng.js";
import { openChecker } from "../cells.js";

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

/** Every piece carries exactly one kind of part. */
const SPECIAL_WEIGHTS: [CellType, number][] = [
  ["engine", 48],
  ["laser", 24],
  ["mirror", 14],
  // Armor is switched off for now (its share moved to mirrors); the part still works if it shows up.
  ["armor", 0],
  ["saw", 10],
  // Grapple is switched off for now: harder to use and weaker than lasers. The part still works.
  ["grapple", 0],
];

function pickSpecial(rng: Rng): CellType {
  const total = SPECIAL_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [type, w] of SPECIAL_WEIGHTS) {
    r -= w;
    if (r < 0) return type;
  }
  return SPECIAL_WEIGHTS[0]![0];
}

const DIRS: Dir[] = [0, 1, 2, 3];
/** Chance an engine piece's second engine faces the same way as the first (otherwise a right angle). */
const SAME_DIR_SECOND_ENGINE = 0.25;

export function generatePiece(rng: Rng, id: string): Piece {
  const shape = rng.pick(PENTOMINO_NAMES);
  const coords = PENTOMINOES[shape];
  const cells: Cell[] = coords.map(([x, y]) => ({ x, y, type: "hull", dir: 0 }));
  const special = pickSpecial(rng);
  if (special === "mirror" || special === "armor") {
    // Shield pieces protect the whole face the piece shows in one direction: every cell
    // with nothing of the piece beyond it that way (a T facing up shields its top bar).
    const dir = rng.pick(DIRS);
    const v = DIR_VECTORS[dir];
    const beyond = (c: Cell) => cells.some((o) => o !== c && (v.x !== 0 ? o.y === c.y && (o.x - c.x) * v.x > 0 : o.x === c.x && (o.y - c.y) * v.y > 0));
    return { id, shape, cells: cells.map((c) => (beyond(c) ? c : { ...c, type: special, dir })) };
  }
  const first = pickSpecialSlot(cells, special, rng, () => true);
  if (!first) return { id, shape, cells };
  cells[first[0]] = { ...cells[first[0]]!, type: special, dir: first[1] };
  if (special === "engine") {
    // A second engine: usually at right angles to the first, sometimes the same way, never opposed.
    const d1 = first[1];
    const same = rng.chance(SAME_DIR_SECOND_ENGINE);
    const allowed = (d: Dir) => (same ? d === d1 : d !== d1 && d !== (((d1 + 2) % 4) as Dir));
    const second = pickSpecialSlot(cells, "engine", rng, allowed) ?? pickSpecialSlot(cells, "engine", rng, (d) => d !== (((d1 + 2) % 4) as Dir));
    if (second) cells[second[0]] = { ...cells[second[0]]!, type: "engine", dir: second[1] };
  }
  return { id, shape, cells };
}

/** Chooses which cell carries the special part and which way it faces. */
/**
 * Chooses a hull cell of the piece to carry the part and which way it faces, among dirs that
 * `allowed` accepts. The part must work on the piece as it stands: its whole working line
 * (and any extra overhang squares) clear of the piece's own cells, the same rule as in play.
 */
function pickSpecialSlot(cells: Cell[], type: CellType, rng: Rng, allowed: (d: Dir) => boolean): [number, Dir] | null {
  const has = (x: number, y: number) => cells.some((c) => c.x === x && c.y === y);
  const open = (c: Cell, d: Dir) => !has(c.x + DIR_VECTORS[d].x, c.y + DIR_VECTORS[d].y);
  const opposite = (d: Dir) => ((d + 2) % 4) as Dir;

  const slots: [number, Dir][] = [];
  cells.forEach((c, i) => {
    if (c.type !== "hull") return;
    const isTip = DIRS.filter((d) => open(c, d)).length === 3;
    for (const d of DIRS) {
      if (!allowed(d)) continue;
      const trial = cells.map((o, k) => (k === i ? { ...o, type, dir: d } : o));
      if (!openChecker(trial)(trial[i]!)) continue;
      if (type === "laser" || type === "saw" || type === "grapple") {
        // Point outward along an arm: a tip cell, facing away from its one neighbour.
        if (isTip && !open(c, opposite(d))) slots.push([i, d]);
      } else {
        slots.push([i, d]);
        if (isTip) slots.push([i, d]);
      }
    }
  });
  return slots.length > 0 ? rng.pick(slots) : null;
}
