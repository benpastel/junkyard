import type { CellType } from "../types.js";

/**
 * How many hits a part takes before it breaks off. 1 = breaks on the first hit;
 * 2 = the first hit leaves a warning crack and the second breaks it.
 */
export const HITS_TO_BREAK = 1;

/** Hits per cell type. All the same for now; override a type here to make it tougher. */
export const CELL_HP: Record<CellType, number> = {
  core: HITS_TO_BREAK,
  hull: HITS_TO_BREAK,
  engine: HITS_TO_BREAK,
  laser: HITS_TO_BREAK,
  grapple: HITS_TO_BREAK,
  saw: HITS_TO_BREAK,
  mirror: HITS_TO_BREAK,
  armor: HITS_TO_BREAK,
};

/** Arena tuning. Times are in seconds, distances in cells (= world units), forces in mass·units/s². */
export const SIM = {
  cellDensity: 1,
  linearDamping: 0.4,
  angularDamping: 1.2,

  engineForce: 65,
  engineRampSeconds: 0.15,

  laserChargeSeconds: 0.25,
  laserCooldownSeconds: 0.8,
  laserRange: 25,
  /** Hits dealt per laser shot. */
  laserDamage: 1,
  laserKnockback: 0.4,
  laserRecoil: 0.1,
  /** How many times one beam can bounce off mirrors. */
  laserMaxBounces: 3,

  grappleRange: 14,
  grappleMinLength: 2.5,
  grappleRetractSpeed: 4,
  grappleStiffness: 60,
  grappleDamping: 8,
  grappleMaxForce: 400,

  /** Relative speed at the contact below which collisions do no damage; above it, each side takes one hit. */
  impactThreshold: 4,
  /** Saw blade: a ball this big, centred this far out from the saw cell's centre toward its dir. */
  /** Wide enough to bite the tile in front and both tiles diagonally in front. */
  sawRadius: 0.8,
  sawReach: 0.8,
  /** A blade in contact with something cuts it (one hit) this often. */
  sawCutSeconds: 0.2,
  impactPairCooldownSeconds: 0.25,
  /** Bounciness of armor cells (other cells use 0.2). */
  armorRestitution: 0.8,
  /** A hit counts as on a protected edge when the incoming direction lines up this well with the edge normal. */
  edgeFacingDot: 0.5,

  spawnMinRadius: 14,
  spawnRadiusPerShip: 4.5,
  ringStartPadding: 14,
  ringMinRadius: 0,
  ringDelaySeconds: 8,
  ringShrinkSeconds: 90,
  /** The ring is a rubber wall made of kinematic segments: bounciness of a ship hitting it. */
  ringRestitution: 0.9,
  ringSegments: 48,
  ringThickness: 2,

  /**
   * Crushing: when the shrinking ring has no slack left, sustained contact force breaks the
   * touching cells. Force (mass·units/s²) above which a contact counts as being crushed, and
   * how long it has to last. Well above what engines alone can push.
   */
  crushForce: 20000,
  crushSeconds: 0.15,
  /** Two crush-proof parts (armor/saw) pressed together give way after this much longer. */
  crushProofFactor: 3,
  /** Cells pressed into the ring itself (rather than another ship) give way after this much longer. */
  crushWallFactor: 3,
  /** Ticks a crushing contact may drop below the threshold without its count resetting. */
  crushGapTicks: 6,
  solverIterations: 8,
  /** After crushing-level pressure, a body ignores impact damage for this long (see SimBody.jammedUntil). */
  jamSeconds: 0.5,
  /** Cells further than this beyond the ring's outer face are crushed. */
  outsideMargin: 1,

  /** Power-up orb at the arena centre from the start, once per fight: grab it for a few seconds of invulnerability. */
  /** Picked up when any cell centre comes this close to the orb. */
  powerupPickupRadius: 1.4,
  invulnerableSeconds: 5,

  debrisLifetimeSeconds: 15,
  debrisScatterImpulse: 0.6,
  /** Safety net only: the ring closes to nothing well before this, crushing whatever is left. */
  maxSeconds: 300,
};
