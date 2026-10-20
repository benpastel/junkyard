// Special arenas (tutorials, and later a campaign): a fight with different rules from a normal
// round. Pass one as ArenaSetup.scenario; anything left out behaves as in a normal fight.

export interface Scenario {
  id: string;
  /** Ring radius in cells, instead of one sized for the number of ships. */
  ringRadius?: number;
  /** The ring stays at its starting size. */
  staticRing?: boolean;
  /** Scatter asteroids (default true). */
  rocks?: boolean;
  /** The mirror-skin orb at the centre (default true). */
  powerup?: boolean;
  /** Sheep in spacesuits to collect: the fight is won once every one is picked up. */
  sheep?: number;
  /** Free-floating saw blades that drift about and cut whatever they touch. Nothing breaks them. */
  hazardSaws?: number;
  /** Give up after this many seconds (default SIM.maxSeconds). */
  maxSeconds?: number;
}

/** Tutorial: an engines-only ship rounds up sheep while dodging floating saws. */
export const SHEEP_ROUNDUP: Scenario = {
  id: "sheep",
  ringRadius: 42,
  staticRing: true,
  rocks: false,
  powerup: false,
  sheep: 12,
  hazardSaws: 5,
  maxSeconds: Infinity,
};

/** Sheep and floating-saw tuning (cells, seconds). */
export const SHEEP = {
  /** A sheep is collected when any cell centre of a ship comes this close. */
  collectRadius: 1.2,
  /** Drawn size; also how close to the ring they may drift. */
  radius: 0.55,
  maxSpeed: 1.4,
  /** Random wandering push, cells/s². */
  wander: 1.6,
  damping: 0.6,
  /** Sheep ease away from saws inside this range, harder the closer they get... */
  avoidRange: 5.5,
  avoidAccel: 9,
  /** ...and never come closer than this to a saw's centre. */
  saw: 2.0,
  /** Kept clear of where the ship starts and of each other when placed. */
  spawnClearance: 7,
  spacing: 4,
};

export const HAZARD_SAW = {
  radius: 1.0,
  /** Drift speed they keep up (cells/s) and spin (rad/s). */
  speed: 2.2,
  spin: 6,
  /** Kept this far from where the ship starts. */
  spawnClearance: 14,
};
