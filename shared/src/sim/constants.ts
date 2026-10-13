import type { CellType } from "../types.js";

export const CELL_HP: Record<CellType, number> = {
  core: 10,
  hull: 4,
  engine: 2,
  laser: 2,
  grapple: 2,
  ram: 5,
  mirror: 4,
  armor: 6,
};

/** Arena tuning. Times are in seconds, distances in cells (= world units), forces in mass·units/s². */
export const SIM = {
  cellDensity: 1,
  linearDamping: 0.4,
  angularDamping: 1.2,

  engineForce: 40,
  engineRampSeconds: 0.15,

  laserChargeSeconds: 0.25,
  laserCooldownSeconds: 0.33,
  laserRange: 25,
  laserDamage: 1,
  laserKnockback: 1.2,
  laserRecoil: 0.35,
  /** How many times one beam can bounce off mirrors. */
  laserMaxBounces: 3,

  grappleRange: 14,
  grappleMinLength: 2.5,
  grappleRetractSpeed: 4,
  grappleStiffness: 60,
  grappleDamping: 8,
  grappleMaxForce: 400,

  /** Relative speed at the contact below which collisions do no damage. */
  impactThreshold: 3,
  impactDamagePerSpeed: 0.7,
  ramDealMultiplier: 3,
  ramTakeMultiplier: 0.25,
  impactPairCooldownSeconds: 0.25,
  /** Bounciness of armor cells (other cells use 0.2). */
  armorRestitution: 0.8,
  /** A hit counts as on a protected edge when the incoming direction lines up this well with the edge normal. */
  edgeFacingDot: 0.5,

  spawnMinRadius: 14,
  spawnRadiusPerShip: 4.5,
  ringStartPadding: 14,
  ringMinRadius: 10,
  ringDelaySeconds: 8,
  ringShrinkSeconds: 90,
  /** The ring is a rubber wall: bounciness of a ship hitting it (1 = perfectly elastic). */
  ringRestitution: 0.9,

  /** Power-up orb at the arena centre: grab it for a few seconds of invulnerability. */
  powerupFirstSeconds: 10,
  powerupRespawnSeconds: 20,
  /** Picked up when any cell centre comes this close to the orb. */
  powerupPickupRadius: 1.4,
  invulnerableSeconds: 5,

  debrisLifetimeSeconds: 15,
  debrisScatterImpulse: 0.6,
  maxSeconds: 150,
};
