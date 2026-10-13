// OWNED BY THE ARENA AGENT. Placeholder API; the arena agent fills this in.
import type { InputState, PlayerId, RoundResultRow, ShipBlueprint } from "../types.js";

export const TICK_HZ = 60;
/** The server broadcasts a snapshot every this many ticks. */
export const SNAPSHOT_EVERY = 3;

export interface ArenaSetup {
  ships: ShipBlueprint[];
  seed: number;
}

/** Static info clients need once, at the start of a fight. */
export interface ArenaInit {
  placeholder: true;
}

/** Periodic state broadcast. */
export interface ArenaSnapshot {
  tick: number;
}

/** Must be awaited once per process before constructing an Arena. */
export async function initPhysics(): Promise<void> {}

export class Arena {
  constructor(_setup: ArenaSetup) {}

  step(_inputs: Record<PlayerId, InputState>): void {}

  init(): ArenaInit {
    return { placeholder: true };
  }

  /** Current state plus any discrete events since the previous snapshot() call. */
  snapshot(): ArenaSnapshot {
    return { tick: 0 };
  }

  get over(): boolean {
    return true;
  }

  results(): RoundResultRow[] {
    return [];
  }

  dispose(): void {}
}

export function arenaBotInput(_arena: Arena, _playerId: PlayerId): InputState {
  return { up: false, down: false, left: false, right: false, laser: false, grapple: false };
}
