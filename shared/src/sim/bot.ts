// Simple, human-ish arena bot. Reads arena internals directly.
import { DIR_VECTORS, NO_INPUT, type BotSkill, type Dir, type InputState, type PlayerId } from "../types.js";
import { Rng } from "../rng.js";
import { SIM } from "./constants.js";
import { KEY_BITS, TICK_HZ, angleDiff } from "./view.js";
import type { Arena, ShipRecord } from "./arena.js";

interface BotState {
  skill: SkillProfile;
  rng: Rng;
  nextDecision: number;
  input: InputState;
  aimNoise: number;
  hookedSince: number | null;
  /** Whether it's minding the fight, until the tick after which it decides again. */
  focused: boolean;
  focusUntil: number;
  /** Where it's wandering while not minding the fight: a heading to fly and one to face. */
  wanderDir: number;
  wanderFace: number;
}

const bots = new WeakMap<Arena, Map<PlayerId, BotState>>();

/** Distances (cells) the bot keeps from its target: lasers in range, a saw while it turns, unarmed well clear. */
const BOT_LASER_HOLD = 8;
const BOT_SAW_HOLD = 6;
const BOT_UNARMED_HOLD = 12;
/** A saw this close to pointing at the target (radians) is lined up enough to charge in. */
const SAW_CHARGE_ANGLE = 0.35;

interface SkillProfile {
  /** Ticks between decisions: min + up to rand more. */
  reactMin: number;
  reactRand: number;
  /** How far off (radians, peak to peak) its aim wanders. */
  aimNoise: number;
  /**
   * Share of the time it minds the fight (picks a target, faces it, keeps its distance); the rest
   * it wanders about, drifting towards open space. Zero never aims at all.
   */
  focus: number;
  /** Go after small, nearby ships rather than just the nearest. */
  pickWeak: boolean;
  /** Side-step out of enemy laser lines. */
  dodge: boolean;
  /** Turn so the lasers' own beams cross the target, not just so they point its way. */
  lineUp: boolean;
  /** Fight from the edge of laser range when outgunned. */
  standoff: boolean;
}

export const BOT_SKILL_PROFILES: Record<BotSkill, SkillProfile> = {
  // Child: flies about at random, never aims.
  child: { reactMin: 20, reactRand: 16, aimNoise: 0, focus: 0, pickWeak: false, dodge: false, lineUp: false, standoff: false },
  // Easy: faces you some of the time, and then only roughly.
  easy: { reactMin: 14, reactRand: 10, aimNoise: 1.4, focus: 0.45, pickWeak: false, dodge: false, lineUp: false, standoff: false },
  // Medium: always fighting, its weapons pointed your way give or take 25 degrees.
  medium: { reactMin: 10, reactRand: 8, aimNoise: 0.9, focus: 1, pickWeak: false, dodge: false, lineUp: false, standoff: false },
  // Faster reactions measured worse (the thrust controller over-corrects), so hard thinks as
  // often as medium did; it wins on steady aim and better choices.
  hard: { reactMin: 8, reactRand: 8, aimNoise: 0.15, focus: 1, pickWeak: true, dodge: true, lineUp: true, standoff: true },
};
/** How long a stretch of minding the fight, or of wandering, lasts (seconds): min + up to rand more. */
const FOCUS_MIN_S = 1.5;
const FOCUS_RAND_S = 2.5;
/** Wandering speed (cells/s), and how strongly it steers away from the nearest ship. */
const WANDER_SPEED = 4;
const WANDER_AWAY = 0.2;

/** Hard bots side-step this fast when an enemy laser is lined up on them. */
const DODGE_SPEED = 5;
/** Hard bots with fewer than this share of their target's cells keep to the edge of laser range. */
const OUTGUNNED = 0.6;

/** Every steering combination worth trying: at most one key of each opposing pair. */
const STEER_MASKS: number[] = [];
for (const v of [0, KEY_BITS.up, KEY_BITS.down])
  for (const h of [0, KEY_BITS.left, KEY_BITS.right])
    for (const r of [0, KEY_BITS.rotLeft, KEY_BITS.rotRight]) STEER_MASKS.push(v | h | r);

export function arenaBotInput(arena: Arena, playerId: PlayerId, skill: BotSkill = "medium"): InputState {
  let perArena = bots.get(arena);
  if (!perArena) bots.set(arena, (perArena = new Map()));
  let st = perArena.get(playerId);
  if (!st) {
    st = {
      skill: BOT_SKILL_PROFILES[skill],
      // Mixed with the arena's seed so a bot doesn't replay the same luck every round.
      rng: new Rng(hash(playerId) ^ arena.seed),
      nextDecision: 0,
      input: NO_INPUT,
      aimNoise: 0,
      hookedSince: null,
      focused: false,
      focusUntil: 0,
      wanderDir: 0,
      wanderFace: 0,
    };
    perArena.set(playerId, st);
  }
  if (arena.tickCount < st.nextDecision) return st.input;
  // Reaction delay: how often it thinks depends on skill.
  st.nextDecision = arena.tickCount + st.skill.reactMin + st.rng.int(st.skill.reactRand);
  st.input = decide(arena, playerId, st);
  return st.input;
}

function decide(arena: Arena, playerId: PlayerId, st: BotState): InputState {
  const me = arena.ship(playerId);
  const rb = me?.body.rb;
  if (!me || !me.alive || !rb) return NO_INPUT;

  const pos = rb.translation();
  const vel = rb.linvel();
  const angle = rb.rotation();
  const w = rb.angvel();
  const com = rb.worldCom();
  const mass = Math.max(1e-3, rb.mass());
  const inertia = Math.max(1e-3, rb.principalInertia());

  if (arena.tickCount >= st.focusUntil) {
    st.focusUntil = arena.tickCount + Math.round((FOCUS_MIN_S + st.rng.next() * FOCUS_RAND_S) * TICK_HZ);
    st.focused = st.rng.chance(st.skill.focus);
    st.wanderDir = st.rng.next() * Math.PI * 2;
    st.wanderFace = st.rng.next() * Math.PI * 2;
  }
  const foe = !st.focused ? null : st.skill.pickWeak ? weakestNearby(arena, me, pos) : nearestEnemy(arena, me, pos);
  const target = foe?.at ?? null;
  const cells = me.body.cells.filter((c) => c.alive);
  // Only parts that actually work count (covered ones do nothing).
  const lasers = cells.filter((c) => c.type === "laser" && arena.isOpen(c));
  const grapples = cells.filter((c) => c.type === "grapple" && arena.isOpen(c));
  const saws = cells.filter((c) => c.type === "saw" && arena.isOpen(c));

  if (st.rng.chance(0.3)) st.aimNoise = (st.rng.next() - 0.5) * st.skill.aimNoise;

  // Which local direction should face the enemy.
  const aimCells = lasers.length ? lasers : saws.length ? saws : grapples;
  const aimDir = dominantDir(aimCells.map((c) => c.dir));
  const aimLocal = Math.atan2(DIR_VECTORS[aimDir].y, DIR_VECTORS[aimDir].x);

  let desiredAngle = angle;
  let desiredVel = { x: 0, y: 0 };
  let dist = Infinity;
  if (target) {
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    dist = Math.hypot(dx, dy);
    const ux = dx / dist;
    const uy = dy / dist;
    desiredAngle = Math.atan2(uy, ux) - aimLocal + st.aimNoise;
    // Lasers off to one side fire parallel to the line through the middle and miss by as much;
    // turn a little further so their beams (on average) pass through the target instead.
    if (st.skill.lineUp && lasers.length) {
      const facing = lasers.filter((c) => c.dir === aimDir);
      const a = DIR_VECTORS[aimDir];
      const lx = (com.x - pos.x) * Math.cos(angle) + (com.y - pos.y) * Math.sin(angle);
      const ly = -(com.x - pos.x) * Math.sin(angle) + (com.y - pos.y) * Math.cos(angle);
      const off = facing.reduce((sum, c) => sum + (c.x - lx) * -a.y + (c.y - ly) * a.x, 0) / Math.max(1, facing.length);
      if (Math.abs(off) < dist) desiredAngle -= Math.asin(off / dist);
    }
    // Only close in to ram when it pays: a working saw already pointing at the target. With
    // lasers, hold off inside their range; with nothing that hurts on contact, keep clear.
    const sawLinedUp = saws.length > 0 && !lasers.length && Math.abs(angleDiff(angle, desiredAngle - st.aimNoise)) < SAW_CHARGE_ANGLE;
    // Outgunned hard bots fight from the edge of laser range instead.
    const outgunned = st.skill.standoff && foe !== null && aliveCells(me) < aliveCells(foe.ship) * OUTGUNNED;
    const laserHold = outgunned ? SIM.laserRange - 1.5 : Math.min(BOT_LASER_HOLD, SIM.laserRange - 4);
    const preferred = sawLinedUp && !outgunned ? 0 : saws.length ? BOT_SAW_HOLD : lasers.length ? laserHold : BOT_UNARMED_HOLD;
    // Ease off on the way in so it settles at its distance instead of overshooting into you.
    // A lined-up saw charges in flat out: that's the whole point of it.
    const speed = sawLinedUp ? 7 : dist > preferred + 3 ? Math.min(7, (dist - preferred) * 0.6) : dist < preferred - 3 ? -4 : 0;
    desiredVel = { x: ux * speed, y: uy * speed };
    // Backing off: most ships can't thrust in reverse, so if this one can't push away from the
    // way it's facing, turn round and fly off on its main engines instead of drifting into you.
    if (speed < 0) {
      const engines = cells.filter((c) => c.type === "engine" && arena.isOpen(c));
      const facing = dominantDir(aimCells.map((c) => c.dir));
      const reverse = ((facing + 2) % 4) as Dir;
      if (!engines.some((c) => c.dir === reverse) && engines.length) {
        const main = dominantDir(engines.map((c) => c.dir));
        const mainLocal = Math.atan2(DIR_VECTORS[main].y, DIR_VECTORS[main].x);
        desiredAngle = Math.atan2(-uy, -ux) - mainLocal;
      }
    }
  } else if (!st.focused) {
    // Wandering: its own heading, bent away from whoever is nearest, facing wherever.
    let wx = Math.cos(st.wanderDir);
    let wy = Math.sin(st.wanderDir);
    const near = nearestEnemy(arena, me, pos);
    if (near) {
      const ax = pos.x - near.at.x;
      const ay = pos.y - near.at.y;
      const d = Math.max(Math.hypot(ax, ay), 1e-3);
      wx += (ax / d) * WANDER_AWAY;
      wy += (ay / d) * WANDER_AWAY;
    }
    const k = WANDER_SPEED / Math.max(Math.hypot(wx, wy), 1e-3);
    desiredVel = { x: wx * k, y: wy * k };
    desiredAngle = st.wanderFace;
  }

  // Hard bots step out of any enemy laser lined up on them.
  if (st.skill.dodge) {
    const dodge = laserDodge(arena, me, pos);
    if (dodge) desiredVel = { x: desiredVel.x + dodge.x * DODGE_SPEED, y: desiredVel.y + dodge.y * DODGE_SPEED };
  }

  // Go for the power-up when it's closer than the fight.
  if (st.focused && arena.powerupActive && Math.hypot(pos.x, pos.y) < Math.min(dist, 18)) {
    const r0 = Math.max(Math.hypot(pos.x, pos.y), 1e-3);
    const speed = r0 > 4 ? 7 : 3;
    desiredVel = { x: (-pos.x / r0) * speed, y: (-pos.y / r0) * speed };
  }

  // Stay inside the ring.
  const r = Math.hypot(pos.x, pos.y);
  if (r > arena.ringRadius - 5) {
    const k = 8 / Math.max(r, 1e-3);
    desiredVel = { x: -pos.x * k, y: -pos.y * k };
  }

  // What each combination of steering keys does, with the engines the ship would really fire for it.
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const effect = (mask: number) => {
    const { engines, throttle } = arena.thrustPlan(me, mask);
    let fx = 0;
    let fy = 0;
    let tq = 0;
    engines.forEach((c, i) => {
      const u = throttle[i]!;
      if (u <= 0) return;
      const d = DIR_VECTORS[c.dir];
      const ex = (d.x * cos - d.y * sin) * SIM.engineForce * u;
      const ey = (d.x * sin + d.y * cos) * SIM.engineForce * u;
      const px = pos.x + c.x * cos - c.y * sin - com.x;
      const py = pos.y + c.x * sin + c.y * cos - com.y;
      fx += ex;
      fy += ey;
      tq += px * ey - py * ex;
    });
    return { fx, fy, tq };
  };
  const options = STEER_MASKS.map((mask) => ({ mask, ...effect(mask) }));

  // Try every combination against a short look-ahead and keep the cheapest.
  // Turning matters most: aim for an angular velocity proportional to the heading error.
  const T = 0.5;
  // Ships that can only spin one way have to go the long way round.
  let canPos = false;
  let canNeg = false;
  for (const e of options) {
    if (e.tq > 1e-3) canPos = true;
    if (e.tq < -1e-3) canNeg = true;
  }
  let err = -angleDiff(angle, desiredAngle);
  if (canPos && !canNeg && err < 0) err += Math.PI * 2;
  if (canNeg && !canPos && err > 0) err -= Math.PI * 2;
  const wantW = Math.max(-1.6, Math.min(1.6, err * 2));
  let best = 0;
  let bestCost = Infinity;
  for (const { mask, fx, fy, tq } of options) {
    const w2 = w + (tq / inertia) * T;
    const vx = vel.x + (fx / mass) * T;
    const vy = vel.y + (fy / mass) * T;
    const cost =
      (w2 - wantW) ** 2 * 2 +
      ((vx - desiredVel.x) ** 2 + (vy - desiredVel.y) ** 2) * 0.04 +
      popcount(mask) * 0.005;
    if (cost < bestCost) {
      bestCost = cost;
      best = mask;
    }
  }

  const input: InputState = {
    up: !!(best & KEY_BITS.up),
    right: !!(best & KEY_BITS.right),
    down: !!(best & KEY_BITS.down),
    left: !!(best & KEY_BITS.left),
    rotLeft: !!(best & KEY_BITS.rotLeft),
    rotRight: !!(best & KEY_BITS.rotRight),
    laser: false,
    grapple: false,
  };

  if (target) {
    const hooked = arena.hasHooks(playerId);
    if (hooked) {
      st.hookedSince ??= arena.tickCount;
      if (arena.tickCount - st.hookedSince > 4 * TICK_HZ) {
        input.grapple = !st.input.grapple;
        if (input.grapple) st.hookedSince = null;
      }
    } else {
      st.hookedSince = null;
      const canHook = grapples.some((c) => aligned(arena.cellWorld(c), arena.cellWorldDir(c), target, 0.25, SIM.grappleRange - 3));
      input.grapple = canHook && !st.input.grapple && st.rng.chance(0.5);
    }
  }
  return input;
}

interface Foe {
  ship: ShipRecord;
  at: { x: number; y: number };
}

function nearestEnemy(arena: Arena, me: ShipRecord, pos: { x: number; y: number }): Foe | null {
  return pickFoe(arena, me, pos, (d) => d);
}

/** Nearby and small: distance weighted by how big the enemy is next to us. */
function weakestNearby(arena: Arena, me: ShipRecord, pos: { x: number; y: number }): Foe | null {
  const mine = Math.max(1, aliveCells(me));
  return pickFoe(arena, me, pos, (d, s) => d * Math.sqrt(Math.max(1, aliveCells(s)) / mine));
}

function pickFoe(arena: Arena, me: ShipRecord, pos: { x: number; y: number }, score: (d: number, s: ShipRecord) => number): Foe | null {
  let best: Foe | null = null;
  let bestScore = Infinity;
  for (const s of arena.ships) {
    if (s === me || !s.alive || !s.body.rb || arena.allied(me, s)) continue;
    const t = s.body.rb.worldCom();
    const sc = score(Math.hypot(t.x - pos.x, t.y - pos.y), s);
    if (sc < bestScore) {
      bestScore = sc;
      best = { ship: s, at: { x: t.x, y: t.y } };
    }
  }
  return best;
}

function aliveCells(s: ShipRecord): number {
  return s.body.cells.filter((c) => c.alive).length;
}

/** Unit vector sideways out of the line of the nearest enemy laser aimed at us, if any. */
function laserDodge(arena: Arena, me: ShipRecord, pos: { x: number; y: number }): { x: number; y: number } | null {
  for (const s of arena.ships) {
    // Teammates' beams only matter when they can hurt.
    if (s === me || !s.alive || (arena.allied(me, s) && !arena.friendlyFire)) continue;
    for (const c of s.body.cells) {
      if (c.type !== "laser" || !c.alive || !arena.isOpen(c)) continue;
      const from = arena.cellWorld(c);
      const dir = arena.cellWorldDir(c);
      if (!aligned(from, dir, pos, 0.2, SIM.laserRange)) continue;
      // Perpendicular to the beam, on whichever side we already are.
      const side = (pos.x - from!.x) * -dir.y + (pos.y - from!.y) * dir.x >= 0 ? 1 : -1;
      return { x: -dir.y * side, y: dir.x * side };
    }
  }
  return null;
}

function aligned(
  from: { x: number; y: number } | null,
  dir: { x: number; y: number },
  target: { x: number; y: number },
  tolerance: number,
  range: number,
): boolean {
  if (!from) return false;
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d > range || d < 1e-3) return false;
  const along = (dx * dir.x + dy * dir.y) / d;
  // Allow wider angles up close, since the target is several cells wide.
  return along > Math.cos(tolerance + Math.atan2(2, d));
}

function dominantDir(dirs: Dir[]): Dir {
  const counts = [0, 0, 0, 0];
  for (const d of dirs) counts[d]!++;
  let best: Dir = 0;
  for (const d of [1, 2, 3] as Dir[]) if (counts[d]! > counts[best]!) best = d;
  return best;
}

function popcount(n: number): number {
  let c = 0;
  for (; n; n &= n - 1) c++;
  return c;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
