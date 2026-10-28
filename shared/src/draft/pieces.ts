import { DIR_VECTORS, type Cell, type CellType, type Dir } from "../types.js";
import type { Rng } from "../rng.js";
import { openChecker, overhangSquares, partOffset, workingDir } from "../cells.js";

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

/** The 5 tetrominoes (J and Z are L and S flipped), dealt alongside the pentominoes with fewer parts. */
export const TETROMINOES = {
  I4: [[0, 0], [0, 1], [0, 2], [0, 3]],
  O4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  T4: [[0, 0], [1, 0], [2, 0], [1, 1]],
  L4: [[0, 0], [0, 1], [0, 2], [1, 2]],
  S4: [[1, 0], [2, 0], [0, 1], [1, 1]],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;

/** Every shape a piece can have. */
export const SHAPES = { ...PENTOMINOES, ...TETROMINOES };
export type PentominoName = keyof typeof PENTOMINOES;
export type ShapeName = keyof typeof SHAPES;
export const PENTOMINO_NAMES = Object.keys(PENTOMINOES) as PentominoName[];
export const SHAPE_NAMES = Object.keys(SHAPES) as ShapeName[];
/** Squares in the smallest shape: a pocket smaller than this can never be filled. */
export const MIN_PIECE_SQUARES = Math.min(...Object.values(SHAPES).map((c) => c.length));

/** A draftable piece. `cells` are in the piece's base orientation, min x/y = 0. */
export interface Piece {
  id: string;
  shape: ShapeName;
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
/**
 * What a piece's parts cost, and how likely each is to be picked when filling a piece's budget.
 * Mirror and armor are coats, not single cells: buying one turns all the piece's remaining plain
 * cells to it (one coat per piece). Grapples are switched off for now (weight 0); they still work.
 */
const COATS: readonly CellType[] = ["mirror", "armor"];
/**
 */
const PART_COST: Partial<Record<CellType, number>> = { engine: 0.5, laser: 1, saw: 1, mirror: 1, grapple: 1, armor: 1 };
const PART_WEIGHTS: [CellType, number][] = [
  ["engine", 65],
  ["laser", 20],
  ["saw", 12],
  ["mirror", 12],
  ["armor", 12],
  ["grapple", 0],
];
/**
 * Each pentomino carries this many points of parts (picked from these); a tetromino less, and
 * less per square too (0.31 against 0.35 on average), since it's easier to place.
 */
const PIECE_BUDGETS = [1.5, 2] as const;
const SMALL_PIECE_BUDGETS = [1, 1.5] as const;

/** What a piece may carry and how much: the normal mix, or a tutorial's restricted one. */
export interface PieceRules {
  weights: readonly (readonly [CellType, number])[];
  budgets: readonly number[];
  /** Budgets for tetrominoes. */
  smallBudgets: readonly number[];
}

export const DEFAULT_PIECE_RULES: PieceRules = { weights: PART_WEIGHTS, budgets: PIECE_BUDGETS, smallBudgets: SMALL_PIECE_BUDGETS };

/** Tutorial: engines only, one or two per piece. */
export const ENGINES_ONLY: PieceRules = { weights: [["engine", 1]], budgets: [0.5, 1], smallBudgets: [0.5, 1] };

function pickPart(rng: Rng, allowed: (t: CellType) => boolean, weights: PieceRules["weights"]): CellType | null {
  const options = weights.filter(([t, w]) => w > 0 && allowed(t));
  const total = options.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const [type, w] of options) {
    r -= w;
    if (r < 0) return type;
  }
  return options[0]![0];
}

const DIRS: Dir[] = [0, 1, 2, 3];

/** A random piece; pass `shapes` to draw its shape only from those (e.g. ones that fit). */
export function generatePiece(rng: Rng, id: string, shapes: readonly ShapeName[] = SHAPE_NAMES, rules: PieceRules = DEFAULT_PIECE_RULES): Piece {
  const shape = rng.pick(shapes);
  const coords: readonly (readonly [number, number])[] = SHAPES[shape];
  const cells: Cell[] = coords.map(([x, y]) => ({ x, y, type: "hull", dir: 0 }));
  let budget: number = rng.pick(coords.length < 5 ? rules.smallBudgets : rules.budgets);
  let coat: CellType | null = null;
  // Squares just outside the piece that a part's overhang already uses (engine exhaust, laser
  // barrel, saw blade): no two parts may share one, so their art never piles up.
  const claimed = new Set<string>();
  const failed = new Set<CellType>();

  while (budget > 0) {
    const type = pickPart(rng, (t) => (PART_COST[t] ?? Infinity) <= budget && !failed.has(t) && !(COATS.includes(t) && coat), rules.weights);
    if (!type) break;
    if (COATS.includes(type)) {
      coat = type;
      budget -= PART_COST[type]!;
      continue;
    }
    // Engines on one piece never push in opposite directions.
    const engineDirs = cells.filter((c) => c.type === "engine").map((c) => c.dir);
    const slot = pickSpecialSlot(cells, type, rng, (d, c) => {
      if (type === "engine" && engineDirs.some((e) => e === (((d + 2) % 4) as Dir))) return false;
      return overhangKeys(c.x, c.y, type, d).every((k) => !claimed.has(k));
    });
    if (!slot) {
      failed.add(type);
      continue;
    }
    const [index, dir] = slot;
    cells[index] = { ...cells[index]!, type, dir };
    for (const k of overhangKeys(cells[index]!.x, cells[index]!.y, type, dir)) claimed.add(k);
    budget -= PART_COST[type]!;
  }
  // The coat goes on last, over whatever plain cells are left.
  return { id, shape, cells: coat ? cells.map((c) => (c.type === "hull" ? { ...c, type: coat } : c)) : cells };
}

/** The squares (as "x,y") outside a part's own cell that its art hangs over. */
function overhangKeys(x: number, y: number, type: CellType, dir: Dir): string[] {
  const w = workingDir(type, dir);
  if (w === null) return [];
  const f = DIR_VECTORS[w];
  const keys = [`${x + f.x},${y + f.y}`];
  for (const [fw, sd] of overhangSquares(type)) {
    const o = partOffset(w, fw, sd);
    keys.push(`${x + o.x},${y + o.y}`);
  }
  return keys;
}

/** Chooses which cell carries the special part and which way it faces. */
/** The square an engine at (x, y) pushing `dir` blows its exhaust into. */
export function exhaustSquare(x: number, y: number, dir: Dir): string {
  const v = DIR_VECTORS[((dir + 2) % 4) as Dir];
  return `${x + v.x},${y + v.y}`;
}

/**
 * Chooses a hull cell of the piece to carry the part and which way it faces, among dirs that
 * `allowed` accepts. The part must work on the piece as it stands: its whole working line
 * (and any extra overhang squares) clear of the piece's own cells, the same rule as in play.
 */
function pickSpecialSlot(cells: Cell[], type: CellType, rng: Rng, allowed: (d: Dir, c: Cell) => boolean): [number, Dir] | null {
  const has = (x: number, y: number) => cells.some((c) => c.x === x && c.y === y);
  const open = (c: Cell, d: Dir) => !has(c.x + DIR_VECTORS[d].x, c.y + DIR_VECTORS[d].y);
  const opposite = (d: Dir) => ((d + 2) % 4) as Dir;

  const slots: [number, Dir][] = [];
  cells.forEach((c, i) => {
    if (c.type !== "hull") return;
    const isTip = DIRS.filter((d) => open(c, d)).length === 3;
    for (const d of DIRS) {
      if (!allowed(d, c)) continue;
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
