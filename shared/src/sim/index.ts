// Arena (combat) simulation. Imports Rapier: server and sandbox only.
// The multiplayer client imports from ./view.ts instead.
import type { ShipBlueprint } from "../types.js";

export interface ArenaSetup {
  ships: ShipBlueprint[];
  seed: number;
}

export * from "./view.js";
export { CELL_HP, SIM } from "./constants.js";
export { Arena, initPhysics } from "./arena.js";
export { BOT_SKILL_PROFILES, arenaBotInput } from "./bot.js";
export { FightRecorder, packInput, replayFight, unpackInput, type FightRecording } from "./replay.js";
