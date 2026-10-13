// Simple, human-ish arena bot. Reads arena internals directly.
import { DIR_VECTORS, NO_INPUT, type Dir, type InputState, type PlayerId } from "../types.js";
import { Rng } from "../rng.js";
import { SIM } from "./constants.js";
import { TICK_HZ, angleDiff } from "./view.js";
import type { Arena, ShipRecord } from "./arena.js";

interface BotState {
  rng: Rng;
  nextDecision: number;
  input: InputState;
  aimNoise: number;
  hookedSince: number | null;
}

const bots = new WeakMap<Arena, Map<PlayerId, BotState>>();

const ARROWS: { key: "up" | "right" | "down" | "left"; dir: Dir }[] = [
  { key: "up", dir: 0 },
  { key: "right", dir: 1 },
  { key: "down", dir: 2 },
  { key: "left", dir: 3 },
];

export function arenaBotInput(arena: Arena, playerId: PlayerId): InputState {
  let perArena = bots.get(arena);
  if (!perArena) bots.set(arena, (perArena = new Map()));
  let st = perArena.get(playerId);
  if (!st) {
    st = { rng: new Rng(hash(playerId)), nextDecision: 0, input: NO_INPUT, aimNoise: 0, hookedSince: null };
    perArena.set(playerId, st);
  }
  if (arena.tickCount < st.nextDecision) return st.input;
  // Reaction delay: think 4-8 times a second.
  st.nextDecision = arena.tickCount + 8 + st.rng.int(8);
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

  const target = nearestEnemy(arena, me, pos);
  const cells = me.body.cells.filter((c) => c.alive);
  const lasers = cells.filter((c) => c.type === "laser");
  const grapples = cells.filter((c) => c.type === "grapple");
  const saws = cells.filter((c) => c.type === "saw");

  if (st.rng.chance(0.3)) st.aimNoise = (st.rng.next() - 0.5) * 0.35;

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
    const preferred = lasers.length ? 11 : 0;
    const speed = dist > preferred + 3 ? 7 : dist < preferred - 3 ? -3 : 0;
    desiredVel = { x: ux * speed, y: uy * speed };
  }

  // Go for the power-up when it's closer than the fight.
  if (arena.powerupActive && Math.hypot(pos.x, pos.y) < Math.min(dist, 18)) {
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

  // Force and torque of each arrow at full thrust.
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const effect = ARROWS.map(({ dir }) => {
    let fx = 0;
    let fy = 0;
    let tq = 0;
    for (const c of cells) {
      if (c.type !== "engine" || c.dir !== dir || !arena.isOpen(c)) continue;
      const d = DIR_VECTORS[c.dir];
      const ex = (d.x * cos - d.y * sin) * SIM.engineForce;
      const ey = (d.x * sin + d.y * cos) * SIM.engineForce;
      const px = pos.x + c.x * cos - c.y * sin - com.x;
      const py = pos.y + c.x * sin + c.y * cos - com.y;
      fx += ex;
      fy += ey;
      tq += px * ey - py * ex;
    }
    return { fx, fy, tq };
  });

  // Try every arrow combination against a short look-ahead and keep the cheapest.
  // Turning matters most: aim for an angular velocity proportional to the heading error.
  const T = 0.5;
  // Ships that can only spin one way have to go the long way round.
  let canPos = false;
  let canNeg = false;
  for (const e of effect) {
    if (e.tq > 1e-3) canPos = true;
    if (e.tq < -1e-3) canNeg = true;
  }
  let err = -angleDiff(angle, desiredAngle);
  if (canPos && !canNeg && err < 0) err += Math.PI * 2;
  if (canNeg && !canPos && err > 0) err -= Math.PI * 2;
  const wantW = Math.max(-1.6, Math.min(1.6, err * 2));
  let best = 0;
  let bestCost = Infinity;
  for (let mask = 0; mask < 16; mask++) {
    let fx = 0;
    let fy = 0;
    let tq = 0;
    for (let i = 0; i < 4; i++) {
      if (!(mask & (1 << i))) continue;
      fx += effect[i]!.fx;
      fy += effect[i]!.fy;
      tq += effect[i]!.tq;
    }
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
    up: !!(best & 1),
    right: !!(best & 2),
    down: !!(best & 4),
    left: !!(best & 8),
    laser: false,
    grapple: false,
  };

  if (target) {
    input.laser = lasers.some((c) => aligned(arena.cellWorld(c), arena.cellWorldDir(c), target, 0.16, SIM.laserRange - 2));
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

function nearestEnemy(arena: Arena, me: ShipRecord, pos: { x: number; y: number }) {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const s of arena.ships) {
    if (s === me || !s.alive || !s.body.rb) continue;
    const t = s.body.rb.worldCom();
    const d = Math.hypot(t.x - pos.x, t.y - pos.y);
    if (d < bestD) {
      bestD = d;
      best = { x: t.x, y: t.y };
    }
  }
  return best;
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
