export type PlayerId = string;

/**
 * Direction in the ship's own frame. Grid x points right, y points down,
 * and the ship's nose points up (-y).
 *   0 = up (forward), 1 = right, 2 = down (backward), 3 = left
 * For an engine, `dir` is the direction it PUSHES the ship (the nozzle points the other way).
 * For a laser / grapple / ram, `dir` is the direction it fires or points.
 */
export type Dir = 0 | 1 | 2 | 3;

export const DIR_VECTORS: Record<Dir, { x: number; y: number }> = {
  0: { x: 0, y: -1 },
  1: { x: 1, y: 0 },
  2: { x: 0, y: 1 },
  3: { x: -1, y: 0 },
};

export const CELL_TYPES = ["core", "hull", "engine", "laser", "grapple", "ram", "shield"] as const;
export type CellType = (typeof CELL_TYPES)[number];

/** One grid cell of a ship, in integer grid coordinates. */
export interface Cell {
  x: number;
  y: number;
  type: CellType;
  dir: Dir;
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

export const HULL_IDS = ["small", "medium", "large"] as const;
export type HullId = (typeof HULL_IDS)[number];

export const BUILD_SECONDS_OPTIONS = [60, 90, 120, 180] as const;

export interface RoomSettings {
  buildSeconds: number;
  hull: HullId;
}

export const DEFAULT_SETTINGS: RoomSettings = { buildSeconds: 120, hull: "medium" };

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
