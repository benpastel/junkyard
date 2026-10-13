// Rapier-free arena types and helpers. The client imports this at runtime;
// it must never import Rapier (directly or via ./arena.ts).
import type { CellType, Dir, PlayerId } from "../types.js";

export const TICK_HZ = 60;
/** The server broadcasts a snapshot every this many ticks. */
export const SNAPSHOT_EVERY = 3;
/** After the fight is decided the arena keeps running (frozen ring, no damage) this long before results. */
export const CELEBRATE_SECONDS = 4;

export interface InitCell {
  /** Unique across the whole arena. Debris keeps the cid of the cell it came from. */
  cid: number;
  /** Position relative to the ship's core, in cells (= world units). */
  x: number;
  y: number;
  type: CellType;
  dir: Dir;
}

export interface InitShip {
  bodyId: number;
  playerId: PlayerId;
  name: string;
  color: string;
  cells: InitCell[];
}

export interface RingParams {
  startRadius: number;
  minRadius: number;
}

/** Static info clients need once, at the start of a fight. */
export interface ArenaInit {
  ships: InitShip[];
  ring: RingParams;
}

export interface BodySnap {
  id: number;
  /** Position of the body origin (the core cell's centre for ships). */
  x: number;
  y: number;
  /** Rotation in radians. */
  a: number;
  vx: number;
  vy: number;
  w: number;
  /** Ship owner, or null for debris. */
  owner: PlayerId | null;
  /**
   * Alive cell ids. Only present when the set changed (or periodically, or on first appearance).
   * When absent, keep the last known list.
   */
  cells?: number[];
  /** Damage per cell in `cells`, quantised 0..9 (0 = pristine). Present together with `cells`. */
  dmg?: number[];
  /** Engines currently thrusting: [cid, level 1..9]. Ships only. */
  thr?: [number, number][];
  /** Lasers currently charging: [cid, level 1..9]. Ships only. */
  chg?: [number, number][];
  /** Present (1) while the ship is invulnerable. */
  inv?: 1;
}

export interface HookSnap {
  /** The grapple cell. */
  from: number;
  /** The cell the hook is stuck in. */
  to: number;
  /** Offset of the hook point inside the target cell, in cell-local units. */
  ox: number;
  oy: number;
}

export type ArenaEvent =
  | { e: "shot"; from: number; x1: number; y1: number; x2: number; y2: number; hit: boolean }
  | { e: "hookMiss"; from: number; x1: number; y1: number; x2: number; y2: number }
  | { e: "boom"; cid: number; x: number; y: number; type: CellType }
  | { e: "spark"; x: number; y: number; power: number }
  | { e: "died"; playerId: PlayerId; killerId: PlayerId | null }
  /** A ship bounced off the rubber ring. */
  | { e: "bounce"; x: number; y: number; power: number }
  | { e: "pickup"; playerId: PlayerId }
  /** The fight is decided. null winner = nobody left. */
  | { e: "over"; winner: PlayerId | null };

/** Periodic state broadcast. */
export interface ArenaSnapshot {
  tick: number;
  ring: number;
  /** Whether the power-up orb is sitting at the centre. */
  powerup: boolean;
  bodies: BodySnap[];
  hooks: HookSnap[];
  events: ArenaEvent[];
}

/** World position of a point given in body-local coordinates. */
export function localToWorld(bx: number, by: number, a: number, lx: number, ly: number): { x: number; y: number } {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: bx + lx * c - ly * s, y: by + lx * s + ly * c };
}

/** Shortest signed difference between two angles. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDiff(b, a) * t;
}
