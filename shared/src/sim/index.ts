// Arena (combat) simulation. Imports Rapier: server and sandbox only.
// The multiplayer client imports from ./view.ts instead.
import type { ShipBlueprint } from "../types.js";
import type { Scenario } from "./scenarios.js";

export interface ArenaSetup {
  ships: ShipBlueprint[];
  seed: number;
  /** A tutorial (or other special arena) instead of a normal fight. */
  scenario?: Scenario;
}

export * from "./view.js";
export * from "./scenarios.js";
export { CELL_HP, SIM } from "./constants.js";
export { Arena, initPhysics } from "./arena.js";
export { BOT_SKILL_PROFILES, arenaBotInput } from "./bot.js";
export { FightRecorder, packInput, replayFight, unpackInput, type FightRecording } from "./replay.js";
