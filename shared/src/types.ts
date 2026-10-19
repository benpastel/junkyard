export type PlayerId = string;

/**
 * Direction in the ship's own frame. Grid x points right, y points down,
 * and the ship's nose points up (-y).
 *   0 = up (forward), 1 = right, 2 = down (backward), 3 = left
 * For an engine, `dir` is the direction it PUSHES the ship (the nozzle points the other way).
 * For a laser / grapple / saw, `dir` is the direction it fires or points.
 * For a mirror / armor, `dir` is the protected edge: mirrors reflect lasers that hit
 * that edge, armor deflects collisions on that edge.
 */
export type Dir = 0 | 1 | 2 | 3;

export const DIR_VECTORS: Record<Dir, { x: number; y: number }> = {
  0: { x: 0, y: -1 },
  1: { x: 1, y: 0 },
  2: { x: 0, y: 1 },
  3: { x: -1, y: 0 },
};

export const CELL_TYPES = ["core", "hull", "engine", "laser", "grapple", "saw", "mirror", "armor"] as const;
export type CellType = (typeof CELL_TYPES)[number];

/** One grid cell of a ship, in integer grid coordinates. */
export interface Cell {
  x: number;
  y: number;
  type: CellType;
  dir: Dir;
  /** Which placed piece the cell came from (cells of one piece share it). Absent on loose pieces and the core. */
  piece?: number;
}

/** A finished ship as it leaves the draft. Contains exactly one core cell. */
export interface ShipBlueprint {
  playerId: PlayerId;
  name: string;
  color: string;
  cells: Cell[];
}

/** Keys held this tick. Clients send these; the sim consumes them. */
export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  laser: boolean;
  grapple: boolean;
}

export const NO_INPUT: InputState = {
  up: false,
  down: false,
  left: false,
  right: false,
  laser: false,
  grapple: false,
};

export const HULL_IDS = ["skiff", "hammerhead", "starfish", "catamaran", "chevron", "crab", "trident", "wing", "panels", "strike", "station", "wedge", "manta", "saucer", "dreadnought"] as const;
export type HullId = (typeof HULL_IDS)[number];

export const HULL_TIERS = ["small", "medium", "large"] as const;
export type HullTier = (typeof HULL_TIERS)[number];

/** How long the build phase lasts, scaled by hull size (see buildSeconds in draft/hulls.ts). */
export const PACES = ["frantic", "fast", "strategic", "unlimited"] as const;
export type Pace = (typeof PACES)[number];

/** How well bots fly and how fast they build. */
export const BOT_SKILLS = ["easy", "medium", "hard"] as const;
export type BotSkill = (typeof BOT_SKILLS)[number];

export interface RoomSettings {
  pace: Pace;
  botSkill: BotSkill;
  /** Ship class: every player picks their own hull from this tier. */
  tier: HullTier;
}

export const DEFAULT_SETTINGS: RoomSettings = { pace: "fast", tier: "small", botSkill: "medium" };

/** A player's ship pick for the next round: a hull of the room's tier, or a random one. */
export type HullChoice = HullId | "random";

export const PLAYER_COLORS = [
  "#e8743b",
  "#4fb3bf",
  "#d9c84a",
  "#b47cd8",
  "#7fc96b",
  "#e05a6d",
  "#6f8fe0",
  "#d89a5f",
] as const;

export const MAX_PLAYERS = PLAYER_COLORS.length;

/** One row of the post-round results table. */
export interface RoundResultRow {
  playerId: PlayerId;
  /** 1 = winner. Ties broken by survival time. */
  place: number;
  kills: number;
  cellsDestroyed: number;
  cellsLost: number;
  survivedSeconds: number;
}
