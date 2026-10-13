import { type Cell, type CellType, type Dir, type PlayerId } from "../types.js";
import { openChecker, workingDir } from "../cells.js";
import type { Rng } from "../rng.js";
import type { Draft, DraftAction, DraftView } from "./index.js";
import { hullCore } from "./hulls.js";
import { transformCells, type Piece } from "./pieces.js";
import { buildableSet, cellKey } from "./rules.js";

export interface Placement {
  x: number;
  y: number;
  rot: Dir;
  flip: boolean;
  cells: Cell[];
}

/** Every valid placement of `piece` onto `existing`. */
export function validPlacements(
  buildable: ReadonlySet<string>,
  existing: readonly Cell[],
  piece: Piece,
  width: number,
  height: number,
): Placement[] {
  const occupied = new Set(existing.map((c) => cellKey(c.x, c.y)));
  const fits = (cells: Cell[]) => {
    let touches = false;
    for (const c of cells) {
      const k = cellKey(c.x, c.y);
      if (!buildable.has(k) || occupied.has(k)) return false;
      if (
        !touches &&
        (occupied.has(cellKey(c.x + 1, c.y)) ||
          occupied.has(cellKey(c.x - 1, c.y)) ||
          occupied.has(cellKey(c.x, c.y + 1)) ||
          occupied.has(cellKey(c.x, c.y - 1)))
      )
        touches = true;
    }
    return touches;
  };
  const out: Placement[] = [];
  const seen = new Set<string>();
  for (const flip of [false, true]) {
    for (const rot of [0, 1, 2, 3] as Dir[]) {
      const shape = transformCells(piece.cells, rot, flip);
      // Skip orientations identical to one already tried (symmetric shapes).
      const sig = shape
        .map((c) => `${c.x},${c.y},${c.type},${c.dir}`)
        .sort()
        .join("|");
      if (seen.has(sig)) continue;
      seen.add(sig);
      for (let y = -4; y < height; y++) {
        for (let x = -4; x < width; x++) {
          const cells = shape.map((c) => ({ ...c, x: c.x + x, y: c.y + y }));
          if (fits(cells)) out.push({ x, y, rot, flip, cells });
        }
      }
    }
  }
  return out;
}

function countType(cells: readonly Cell[], type: CellType, dir?: Dir): number {
  return cells.filter((c) => c.type === type && (dir === undefined || c.dir === dir)).length;
}

/** How much the bot wants this kind of part, given what it already has. */
function typeValue(type: CellType, ship: readonly Cell[]): number {
  switch (type) {
    case "engine": {
      const n = countType(ship, "engine");
      return n === 0 ? 12 : n < 2 ? 7 : n < 4 ? 3.5 : 1.2;
    }
    case "laser":
      return countType(ship, "laser") < 2 ? 4 : 2;
    case "mirror":
    case "armor":
      return countType(ship, type) < 2 ? 1.5 : 0.6;
    case "ram":
      return countType(ship, "ram") < 1 ? 2 : 0.8;
    case "grapple":
      return countType(ship, "grapple") < 1 ? 1.5 : 0.2;
    default:
      return 0;
  }
}

interface ShipContext {
  core: { x: number; y: number };
  cells: readonly Cell[];
  /** Directional parts that currently have a clear line out. */
  openParts: Cell[];
  occupied: Set<string>;
  massTilt: number;
  engineTilt: number;
}

function shipContext(view: DraftView): ShipContext {
  const core = hullCore(view.hull);
  const ship = view.cells;
  const isOpen = openChecker(ship);
  return {
    core,
    cells: ship,
    openParts: ship.filter((c) => workingDir(c.type, c.dir) !== null && isOpen(c)),
    occupied: new Set(ship.map((c) => cellKey(c.x, c.y))),
    massTilt: ship.reduce((s, c) => s + (c.x - core.x), 0),
    engineTilt: ship.filter((c) => c.type === "engine" && c.dir === 0).reduce((s, c) => s + (c.x - core.x), 0),
  };
}

function scorePlacement(p: Placement, ctx: ShipContext): number {
  const { core, occupied } = ctx;
  let score = 0;
  const isOpen = openChecker([...ctx.cells, ...p.cells]);
  // Covering a part we already placed switches it off.
  for (const c of ctx.openParts) if (!isOpen(c)) score -= 5;

  for (const c of p.cells) {
    const dy = c.y - core.y; // positive = toward the back
    // Compactness: touching the existing ship.
    for (const [dx, dyy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (occupied.has(cellKey(c.x + dx, c.y + dyy))) score += 0.6;
    }
    score -= Math.abs(c.x - core.x) * 0.15 + Math.abs(dy) * 0.1;

    switch (c.type) {
      case "engine": {
        if (c.dir === 0) score += 3 + dy * 0.8;
        else if (c.dir === 2) score -= 1;
        else score += 0.5 - dy * 0.3; // side thrusters steer best near the nose
        if (!isOpen(c)) score -= 5; // exhaust covered
        break;
      }
      case "laser":
      case "ram":
      case "grapple": {
        if (c.dir === 0) score += 3 - dy * 0.6;
        else if (c.dir === 2) score -= 2;
        if (!isOpen(c)) score -= 5; // pointing into our own hull
        break;
      }
      case "mirror":
      case "armor": {
        // The protected edge belongs on the outside, ideally facing forward.
        if (!isOpen(c)) score -= 4;
        else score += c.dir === 0 ? 2 : c.dir === 2 ? 0.3 : 1;
        break;
      }
    }
  }

  // Left/right balance of mass and of forward engines.
  let massTilt = ctx.massTilt;
  let engineTilt = ctx.engineTilt;
  for (const c of p.cells) {
    massTilt += c.x - core.x;
    if (c.type === "engine" && c.dir === 0) engineTilt += c.x - core.x;
  }
  score -= Math.abs(massTilt) * 0.25 + Math.abs(engineTilt) * 0.9;
  return score;
}

function bestPlacement(view: DraftView, piece: Piece, rng: Rng): { placement: Placement; score: number } | null {
  const buildable = buildableSet(view.hullRows);
  const width = view.hullRows[0]!.length;
  const height = view.hullRows.length;
  const ctx = shipContext(view);
  let best: { placement: Placement; score: number } | null = null;
  for (const placement of validPlacements(buildable, view.cells, piece, width, height)) {
    const score = scorePlacement(placement, ctx) + rng.next() * 1.2;
    if (!best || score > best.score) best = { placement, score };
  }
  return best;
}

/** Next action for a bot, or null to wait. Called every couple of seconds. */
export function draftBotAction(draft: Draft, playerId: PlayerId, rng: Rng): DraftAction | null {
  const view = draft.view(playerId);

  if (view.held) {
    const best = bestPlacement(view, view.held, rng);
    if (!best) return { type: "discard" };
    const { x, y, rot, flip } = best.placement;
    return { type: "place", x, y, rot, flip };
  }

  const candidates: { piece: Piece; from: "offer" | "pool" }[] = [
    ...view.offers.map((piece) => ({ piece, from: "offer" as const })),
    ...view.pool.map((piece) => ({ piece, from: "pool" as const })),
  ];
  let choice: { piece: Piece; from: "offer" | "pool"; score: number } | null = null;
  for (const { piece, from } of candidates) {
    const best = bestPlacement(view, piece, rng);
    if (!best) continue;
    const special = piece.cells.find((c) => c.type !== "hull");
    const score = best.score + (special ? typeValue(special.type, view.cells) : 0) + rng.next() * 2;
    if (!choice || score > choice.score) choice = { piece, from, score };
  }
  if (!choice) {
    // Nothing fits: take an offer anyway; it gets discarded next turn, which brings fresh offers.
    const first = view.offers[0];
    return first ? { type: "takeOffer", pieceId: first.id } : null;
  }
  return choice.from === "offer"
    ? { type: "takeOffer", pieceId: choice.piece.id }
    : { type: "takePool", pieceId: choice.piece.id };
}
