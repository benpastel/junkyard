import type { Cell, Dir, HullId, PlayerId } from "../types.js";
import { Rng } from "../rng.js";
import { cockpitCells } from "../cells.js";
import { hullBuildable, hullCore, HULLS } from "./hulls.js";
import { generatePiece, placedCells, type Piece } from "./pieces.js";
import { cellKey as key, fittingShapes, placementError } from "./rules.js";

export * from "./hulls.js";
export * from "./pieces.js";
export * from "./rules.js";
export { draftBotAction, validPlacements } from "./bot.js";

export type DraftAction =
  /** Pick up one of my offers (the rest stay on offer until I place it). */
  | { type: "takeOffer"; pieceId: string }
  | { type: "takePool"; pieceId: string }
  | { type: "place"; x: number; y: number; rot: Dir; flip: boolean }
  /** Put the held piece back among my offers. */
  | { type: "discard" }
  /** Throw away all my offers; fresh ones arrive after REROLL_SECONDS (see finishReroll). */
  | { type: "reroll" };

/** Everything one player's draft screen needs. Personalised per player. */
export interface DraftView {
  hull: HullId;
  /** ASCII hull map, see HullDef.rows. */
  hullRows: string[];
  /** My placed cells, including the core, in hull grid coordinates. */
  cells: Cell[];
  /** My private offers, including the one I'm holding. Empty while a reroll is dealing. */
  offers: Piece[];
  held: Piece | null;
  /** A reroll is under way: new offers are on their way. */
  dealing: boolean;
  /** Nothing fits on my ship any more, so I'm done building. */
  full: boolean;
  /** The shared pool, oldest first (always empty while POOL_ENABLED is off). */
  pool: Piece[];
  rivals: { playerId: PlayerId; hullRows: string[]; cells: Cell[] }[];
}

export const OFFER_COUNT = 3;
export const POOL_CAP = 18;
/**
 * The shared pool (unused offers go to a tray anyone can take from). Switched off for now;
 * with it off, pieces you don't use just disappear.
 */
export const POOL_ENABLED = false;
/** How long a reroll takes to deal new offers, so you can't cycle through them for free. */
export const REROLL_SECONDS = 1;

interface PlayerDraft {
  hull: HullId;
  buildable: Set<string>;
  offers: Piece[];
  held: Piece | null;
  cells: Cell[];
  dealing: boolean;
  /** Nothing fits on the ship any more. */
  full: boolean;
}

export class Draft {
  private readonly rng: Rng;
  private readonly players = new Map<PlayerId, PlayerDraft>();
  private pool: Piece[] = [];
  private nextId = 1;

  /** Every player builds on `hull` unless `hulls` gives them their own. */
  constructor(opts: { playerIds: PlayerId[]; hull: HullId; seed: number; hulls?: Partial<Record<PlayerId, HullId>> }) {
    this.rng = new Rng(opts.seed);
    for (const id of opts.playerIds) this.addPlayer(id, opts.hulls?.[id] ?? opts.hull);
  }

  /** Adds a builder (e.g. someone joining mid-draft) with an empty ship. */
  addPlayer(id: PlayerId, hull: HullId) {
    if (this.players.has(id)) return;
    const core = hullCore(hull);
    const p: PlayerDraft = {
      hull,
      buildable: new Set(hullBuildable(hull).map((q) => key(q.x, q.y))),
      offers: [],
      held: null,
      cells: cockpitCells(core.x, core.y),
      dealing: false,
      full: false,
    };
    p.offers = this.dealOffers(p);
    this.players.set(id, p);
  }

  has(id: PlayerId): boolean {
    return this.players.has(id);
  }

  /** Returns null on success, or a short error message. */
  apply(playerId: PlayerId, action: DraftAction): string | null {
    const p = this.players.get(playerId);
    if (!p) return "Not in this draft";
    switch (action.type) {
      case "takeOffer": {
        const piece = p.offers.find((o) => o.id === action.pieceId);
        if (!piece) return "Offer gone";
        // Switching pieces is fine: the offers stay put until one is placed.
        p.held = piece;
        return null;
      }
      case "takePool": {
        if (!POOL_ENABLED) return "No pool";
        if (p.held) return "Already holding a piece";
        const i = this.pool.findIndex((o) => o.id === action.pieceId);
        if (i < 0) return "Someone else took it";
        p.held = this.pool.splice(i, 1)[0]!;
        return null;
      }
      case "place": {
        if (!p.held) return "Not holding a piece";
        if (![0, 1, 2, 3].includes(action.rot)) return "Bad rotation";
        const cells = placedCells(p.held, action.x, action.y, action.rot, !!action.flip);
        const err = placementError(p.buildable, p.cells, cells);
        if (err) return err;
        // Tag the cells with this placement so the art knows which neighbours share a piece.
        const piece = p.cells.length;
        p.cells.push(...cells.map((c) => ({ ...c, piece })));
        // The rest of this hand goes (to the pool, if it's on) and a fresh hand is dealt.
        const placed = p.held;
        this.addToPool(p.offers.filter((o) => o !== placed));
        p.held = null;
        p.offers = this.dealOffers(p);
        return null;
      }
      case "discard": {
        if (!p.held) return "Not holding a piece";
        // A piece taken from the pool goes back there; one from my offers is still in them.
        if (!p.offers.includes(p.held)) this.addToPool([p.held]);
        p.held = null;
        return null;
      }
      case "reroll": {
        if (p.dealing) return "Already dealing";
        this.addToPool(p.offers);
        p.offers = [];
        p.held = null;
        p.dealing = true;
        return null;
      }
      default:
        return "Unknown action";
    }
  }

  view(playerId: PlayerId): DraftView {
    const p = this.players.get(playerId);
    const rivals: DraftView["rivals"] = [];
    for (const [id, other] of this.players) {
      if (id !== playerId) rivals.push({ playerId: id, hullRows: HULLS[other.hull].rows, cells: other.cells.slice() });
    }
    const hull = p?.hull ?? "hauler";
    return {
      hull,
      hullRows: HULLS[hull].rows,
      cells: p ? p.cells.slice() : [],
      offers: p ? p.offers.slice() : [],
      held: p?.held ?? null,
      dealing: p?.dealing ?? false,
      full: p?.full ?? false,
      pool: this.pool.slice(),
      rivals,
    };
  }

  /** The finished ship cells (including the core). */
  blueprintCells(playerId: PlayerId): Cell[] {
    return this.players.get(playerId)?.cells.map((c) => ({ ...c })) ?? [];
  }

  /** Deals the new hand a reroll is waiting on. The caller runs this REROLL_SECONDS after the reroll. */
  finishReroll(playerId: PlayerId) {
    const p = this.players.get(playerId);
    if (!p?.dealing) return;
    p.dealing = false;
    p.offers = this.dealOffers(p);
  }

  /**
   * A fresh hand, drawn from an endless bag but only in shapes that fit somewhere on the ship
   * right now. If nothing fits any more, the ship is full: no hand, and it counts as done.
   */
  private dealOffers(p: PlayerDraft): Piece[] {
    const shapes = fittingShapes(p.buildable, p.cells);
    p.full = shapes.length === 0;
    if (p.full) return [];
    return Array.from({ length: OFFER_COUNT }, () => generatePiece(this.rng, `p${this.nextId++}`, shapes));
  }

  /** Nothing fits on this player's ship any more. */
  isFull(playerId: PlayerId): boolean {
    return this.players.get(playerId)?.full ?? false;
  }

  private addToPool(pieces: Piece[]) {
    if (!POOL_ENABLED) return;
    this.pool.push(...pieces);
    if (this.pool.length > POOL_CAP) this.pool.splice(0, this.pool.length - POOL_CAP);
  }
}
