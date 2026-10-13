// OWNED BY THE DRAFT AGENT. Placeholder API; the draft agent fills this in.
import type { Cell, Dir, HullId, PlayerId } from "../types.js";
import type { Rng } from "../rng.js";

export type DraftAction =
  | { type: "takeOffer"; pieceId: string }
  | { type: "takePool"; pieceId: string }
  | { type: "place"; x: number; y: number; rot: Dir; flip: boolean }
  | { type: "discard" };

/** Everything one player's draft screen needs. Personalised per player. */
export interface DraftView {
  placeholder: true;
}

export class Draft {
  constructor(_opts: { playerIds: PlayerId[]; hull: HullId; seed: number }) {}

  /** Returns null on success, or a short error message. */
  apply(_playerId: PlayerId, _action: DraftAction): string | null {
    return "not implemented";
  }

  view(_playerId: PlayerId): DraftView {
    return { placeholder: true };
  }

  /** The finished ship cells (including the core). */
  blueprintCells(_playerId: PlayerId): Cell[] {
    return [{ x: 0, y: 0, type: "core", dir: 0 }];
  }
}

/** Next action for a bot, or null to wait. Called every couple of seconds. */
export function draftBotAction(_draft: Draft, _playerId: PlayerId, _rng: Rng): DraftAction | null {
  return null;
}
