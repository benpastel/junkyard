import type { Cell, Dir, HullId, PlayerId } from "../types.js";
import { Rng } from "../rng.js";
import { hullBuildable, hullCore, HULLS } from "./hulls.js";
import { generatePiece, placedCells, type Piece } from "./pieces.js";
import { cellKey as key, placementError } from "./rules.js";

export * from "./hulls.js";
export * from "./pieces.js";
export * from "./rules.js";
export { draftBotAction } from "./bot.js";

export type DraftAction =
  | { type: "takeOffer"; pieceId: string }
  | { type: "takePool"; pieceId: string }
  | { type: "place"; x: number; y: number; rot: Dir; flip: boolean }
  | { type: "discard" };

/** Everything one player's draft screen needs. Personalised per player. */
export interface DraftView {
  hull: HullId;
  /** ASCII hull map, see HullDef.rows. */
  hullRows: string[];
  /** My placed cells, including the core, in hull grid coordinates. */
  cells: Cell[];
  /** My private offers. Empty while I hold a piece taken from them. */
  offers: Piece[];
  held: Piece | null;
  /** The shared pool, oldest first. */
  pool: Piece[];
  rivals: { playerId: PlayerId; cells: Cell[] }[];
}

export const OFFER_COUNT = 3;
export const POOL_CAP = 18;

interface PlayerDraft {
  offers: Piece[];
  held: Piece | null;
  cells: Cell[];
}

export class Draft {
  readonly hull: HullId;
  private readonly rng: Rng;
  private readonly buildable: Set<string>;
  private readonly players = new Map<PlayerId, PlayerDraft>();
  private pool: Piece[] = [];
  private nextId = 1;

  constructor(opts: { playerIds: PlayerId[]; hull: HullId; seed: number }) {
    this.hull = opts.hull;
    this.rng = new Rng(opts.seed);
    this.buildable = new Set(hullBuildable(opts.hull).map((p) => key(p.x, p.y)));
    const core = hullCore(opts.hull);
    for (const id of opts.playerIds) {
      this.players.set(id, { offers: this.dealOffers(), held: null, cells: [{ ...core, type: "core", dir: 0 }] });
    }
  }

  /** Returns null on success, or a short error message. */
  apply(playerId: PlayerId, action: DraftAction): string | null {
    const p = this.players.get(playerId);
    if (!p) return "Not in this draft";
    switch (action.type) {
      case "takeOffer": {
        if (p.held) return "Already holding a piece";
        const piece = p.offers.find((o) => o.id === action.pieceId);
        if (!piece) return "Offer gone";
        this.addToPool(p.offers.filter((o) => o !== piece));
        p.offers = [];
        p.held = piece;
        return null;
      }
      case "takePool": {
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
        const err = placementError(this.buildable, p.cells, cells);
        if (err) return err;
        // Tag the cells with this placement so the art knows which neighbours share a piece.
        const piece = p.cells.length;
        p.cells.push(...cells.map((c) => ({ ...c, piece })));
        p.held = null;
        this.refill(p);
        return null;
      }
      case "discard": {
        if (!p.held) return "Not holding a piece";
        this.addToPool([p.held]);
        p.held = null;
        this.refill(p);
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
      if (id !== playerId) rivals.push({ playerId: id, cells: other.cells.slice() });
    }
    return {
      hull: this.hull,
      hullRows: HULLS[this.hull].rows,
      cells: p ? p.cells.slice() : [],
      offers: p ? p.offers.slice() : [],
      held: p?.held ?? null,
      pool: this.pool.slice(),
      rivals,
    };
  }

  /** The finished ship cells (including the core). */
  blueprintCells(playerId: PlayerId): Cell[] {
    return this.players.get(playerId)?.cells.map((c) => ({ ...c })) ?? [];
  }

  private refill(p: PlayerDraft) {
    if (p.offers.length === 0) p.offers = this.dealOffers();
  }

  private dealOffers(): Piece[] {
    return Array.from({ length: OFFER_COUNT }, () => generatePiece(this.rng, `p${this.nextId++}`));
  }

  private addToPool(pieces: Piece[]) {
    this.pool.push(...pieces);
    if (this.pool.length > POOL_CAP) this.pool.splice(0, this.pool.length - POOL_CAP);
  }
}
