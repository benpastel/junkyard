import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import type { RigidBody, Collider, World, EventQueue } from "@dimforge/rapier2d-deterministic-compat";
import { DIR_VECTORS, NO_INPUT, type CellType, type Dir, type InputState, type PlayerId, type RoundResultRow } from "../types.js";
import { Rng } from "../rng.js";
import { openChecker } from "../cells.js";
import { CELL_HP, SIM } from "./constants.js";
import {
  TICK_HZ,
  localToWorld,
  type ArenaEvent,
  type ArenaInit,
  type ArenaSnapshot,
  type BodySnap,
  type HookSnap,
  type InitShip,
} from "./view.js";
import type { ArenaSetup } from "./index.js";

const DT = 1 / TICK_HZ;

let physicsReady = false;

/** Must be awaited once per process before constructing an Arena. */
export async function initPhysics(): Promise<void> {
  if (physicsReady) return;
  await RAPIER.init();
  physicsReady = true;
}

export interface SimCell {
  cid: number;
  /** Position in the body's local frame (relative to the original core). */
  x: number;
  y: number;
  type: CellType;
  dir: Dir;
  hp: number;
  maxHp: number;
  alive: boolean;
  collider: Collider | null;
  /** Saws: the round blade sticking out past the cell, a second collider on the same body. */
  blade: Collider | null;
  body: SimBody | null;
  /** Engines: 0..1 thrust level. */
  thrust: number;
  /** Lasers: seconds of charge accumulated while held. */
  charge: number;
  /** Lasers: seconds until the next shot is allowed. */
  cooldown: number;
}

export interface SimBody {
  id: number;
  kind: "ship" | "debris";
  owner: PlayerId | null;
  rb: RigidBody | null;
  cells: SimCell[];
  /** Cells changed since the last snapshot. */
  dirty: boolean;
  sent: boolean;
  /** Debris: tick at which it disappears. */
  despawnTick: number;
  /**
   * Until this tick the body is jammed (squeezed by the ring with other bodies). The solver
   * shoves jammed bodies apart hard, so impacts on them deal no damage; crushing decides instead.
   */
  jammedUntil: number;
}

export interface ShipRecord {
  playerId: PlayerId;
  body: SimBody;
  core: SimCell;
  alive: boolean;
  deathTick: number | null;
  lastDamager: PlayerId | null;
  kills: number;
  cellsDestroyed: number;
  cellsLost: number;
  cellCount: number;
  /** Tick until which the ship takes no damage. */
  /** Power-up: until this tick the whole outer surface reflects lasers like a mirror. */
  mirroredUntil: number;
}

interface Hook {
  from: SimCell;
  to: SimCell;
  /** Hook point offset inside the target cell, in body-local units. */
  ox: number;
  oy: number;
  length: number;
}

interface PreVel {
  vx: number;
  vy: number;
  w: number;
  cx: number;
  cy: number;
  mass: number;
}

export class Arena {
  readonly world: World;
  readonly ships: ShipRecord[] = [];
  readonly bodies: SimBody[] = [];
  tickCount = 0;
  ringRadius: number;

  private readonly ringStart: number;
  private readonly rng: Rng;
  private readonly eventQueue: EventQueue;
  private readonly cellByCollider = new Map<number, SimCell>();
  private readonly shipByPlayer = new Map<PlayerId, ShipRecord>();
  private readonly prevInputs = new Map<PlayerId, InputState>();
  private readonly pairCooldown = new Map<string, number>();
  private hooks: Hook[] = [];
  /** Tick at which the power-up orb next appears, or null while it is sitting at the centre. */
  private powerupTaken = false;
  private disposed = false;
  /** Set on the tick the fight is decided; from then on the ring stops and nothing takes damage. */
  private endedAt: number | null = null;
  private finalResults: RoundResultRow[] | null = null;
  /** Optional debug log of everything that breaks and why. Unset in normal play (zero cost). */
  onLog: ((line: string) => void) | null = null;
  private readonly bounceCooldown = new Map<SimBody, number>();
  /** Saw blades touching something: blade handle:other handle -> next tick it cuts. */
  private readonly sawContacts = new Map<string, { blade: number; other: number; next: number }>();
  private readonly bladeColliders = new Set<number>();
  /** Cell-on-cell contacts between two ships: pair key -> the colliders and the tick they met. */
  private readonly touching = new Map<string, { h1: number; h2: number; since: number }>();
  /** Kinematic segments forming the rubber ring, and their collider handles. */
  private readonly walls: { rb: RigidBody; angle: number }[] = [];
  private readonly wallColliders = new Set<number>();
  /** Sustained-pressure bookkeeping per touching collider pair: consecutive crushing ticks. */
  private readonly pressure = new Map<string, { ticks: number; lastTick: number }>();
  /** Per-body "is this part's line clear?" checkers, rebuilt whenever a body's cells change. */
  private openCache = new Map<SimBody, (c: SimCell) => boolean>();
  private events: ArenaEvent[] = [];
  private nextBodyId = 1;
  private snapCount = 0;
  private readonly initInfo: ArenaInit;
  private readonly startedShips: number;

  constructor(setup: ArenaSetup) {
    if (!physicsReady) throw new Error("call initPhysics() first");
    this.rng = new Rng(setup.seed);
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = DT;
    // Extra solver iterations keep jammed-together ships stable when the ring squeezes them.
    this.world.integrationParameters.numSolverIterations = SIM.solverIterations;
    this.eventQueue = new RAPIER.EventQueue(true);

    const n = setup.ships.length;
    const spawnR = Math.max(SIM.spawnMinRadius, n * SIM.spawnRadiusPerShip);
    this.ringStart = spawnR + SIM.ringStartPadding;
    this.ringRadius = this.ringStart;

    let cid = 1;
    const initShips: InitShip[] = [];
    setup.ships.forEach((bp, i) => {
      const theta = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(theta) * spawnR;
      const py = Math.sin(theta) * spawnR;
      // Nose (local -y) points at the origin: R(a)·(0,-1) = (sin a, -cos a) = -p/|p|.
      const a = Math.atan2(-px, py);

      const core = bp.cells.find((c) => c.type === "core") ?? bp.cells[0];
      const ox = core?.x ?? 0;
      const oy = core?.y ?? 0;
      const body = this.newBody("ship", bp.playerId, px, py, a, 0, 0, 0);
      const cells: SimCell[] = bp.cells.map((c) => ({
        cid: cid++,
        x: c.x - ox,
        y: c.y - oy,
        type: c.type,
        dir: c.dir,
        hp: CELL_HP[c.type],
        maxHp: CELL_HP[c.type],
        alive: true,
        collider: null,
        blade: null,
        body: null,
        thrust: 0,
        charge: 0,
        cooldown: 0,
      }));
      for (const c of cells) this.attachCell(body, c);
      const coreCell = cells.find((c) => c.type === "core") ?? cells[0]!;
      const rec: ShipRecord = {
        playerId: bp.playerId,
        body,
        core: coreCell,
        alive: cells.length > 0,
        deathTick: null,
        lastDamager: null,
        kills: 0,
        cellsDestroyed: 0,
        cellsLost: 0,
        cellCount: cells.length,
        mirroredUntil: 0,
      };
      this.ships.push(rec);
      this.shipByPlayer.set(bp.playerId, rec);
      initShips.push({
        bodyId: body.id,
        playerId: bp.playerId,
        name: bp.name,
        color: bp.color,
        cells: cells.map((c) => ({ cid: c.cid, x: c.x, y: c.y, type: c.type, dir: c.dir })),
      });
    });
    this.startedShips = this.ships.length;
    this.buildWalls();
    this.initInfo = { ships: initShips, ring: { startRadius: this.ringStart, minRadius: SIM.ringMinRadius } };
  }

  // ---------------------------------------------------------------- public API

  init(): ArenaInit {
    return this.initInfo;
  }

  get aliveShips(): ShipRecord[] {
    return this.ships.filter((s) => s.alive);
  }

  /** True once the fight is decided (latched: stays true through the celebration). */
  get over(): boolean {
    return this.endedAt !== null || this.decided;
  }

  private get decided(): boolean {
    const alive = this.aliveShips.length;
    if (this.tickCount >= SIM.maxSeconds * TICK_HZ) return true;
    if (this.startedShips >= 2) return alive <= 1;
    return alive === 0;
  }

  ship(playerId: PlayerId): ShipRecord | undefined {
    return this.shipByPlayer.get(playerId);
  }

  hasHooks(playerId: PlayerId): boolean {
    return this.hooks.some((h) => h.from.body?.owner === playerId);
  }

  step(inputs: Record<PlayerId, InputState>): void {
    // Touching a freed Rapier world corrupts WASM memory; a stray late step must be a no-op.
    if (this.disposed) return;
    this.tickCount++;
    this.updateRing();

    const touched = new Set<SimBody>();
    for (const ship of this.ships) {
      if (!ship.alive) continue;
      const input = inputs[ship.playerId] ?? NO_INPUT;
      const prev = this.prevInputs.get(ship.playerId) ?? NO_INPUT;
      this.applyEngines(ship, input);
      this.updateLasers(ship, input, touched);
      if (input.grapple && !prev.grapple) this.toggleGrapple(ship);
      this.prevInputs.set(ship.playerId, { ...input });
    }
    this.applyHooks();

    const pre = new Map<SimBody, PreVel>();
    for (const b of this.bodies) {
      if (!b.rb) continue;
      const v = b.rb.linvel();
      const c = b.rb.worldCom();
      pre.set(b, { vx: v.x, vy: v.y, w: b.rb.angvel(), cx: c.x, cy: c.y, mass: b.rb.mass() });
    }

    this.world.step(this.eventQueue);

    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      const blade = this.bladeColliders.has(h1) ? h1 : this.bladeColliders.has(h2) ? h2 : null;
      if (blade !== null) {
        const key = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
        if (started) this.sawContacts.set(key, { blade, other: blade === h1 ? h2 : h1, next: this.tickCount });
        else this.sawContacts.delete(key);
        return;
      }
      this.trackTouching(h1, h2, started);
      if (started) this.onCollision(h1, h2, pre, touched);
    });
    this.updateSaws(touched);
    this.breakStuck(touched);
    this.eventQueue.drainContactForceEvents((e) => this.onPressure(e.collider1(), e.collider2(), e.totalForceMagnitude(), touched));

    this.updatePowerup();
    if (this.endedAt === null && this.decided) {
      this.endedAt = this.tickCount;
      this.finalResults = this.computeResults();
      const winners = this.finalResults.filter((r) => r.place === 1 && this.ship(r.playerId)?.alive);
      const winner = winners.length === 1 ? winners[0]!.playerId : null;
      this.events.push({ e: "over", winner });
      this.log(`fight over: ${winner ?? "nobody"} wins`);
    }
    if (this.tickCount % 10 === 0) this.crushOutside(touched);

    for (const b of touched) this.splitBody(b);
    this.despawnDebris();
  }

  snapshot(): ArenaSnapshot {
    this.snapCount++;
    const full = this.snapCount % 20 === 1;
    const bodies: BodySnap[] = [];
    for (const b of this.bodies) {
      if (!b.rb) continue;
      const t = b.rb.translation();
      const v = b.rb.linvel();
      const s: BodySnap = {
        id: b.id,
        x: r3(t.x),
        y: r3(t.y),
        a: r3(b.rb.rotation()),
        vx: r3(v.x),
        vy: r3(v.y),
        w: r3(b.rb.angvel()),
        owner: b.owner,
      };
      if (b.dirty || !b.sent || full) {
        const alive = b.cells.filter((c) => c.alive);
        s.cells = alive.map((c) => c.cid);
        s.dmg = alive.map((c) => Math.round((1 - c.hp / c.maxHp) * 9));
        b.dirty = false;
        b.sent = true;
      }
      if (b.kind === "ship") {
        const thr: [number, number][] = [];
        const chg: [number, number][] = [];
        for (const c of b.cells) {
          if (!c.alive) continue;
          if (c.type === "engine" && c.thrust > 0.05) thr.push([c.cid, Math.max(1, Math.round(c.thrust * 9))]);
          if (c.type === "laser" && c.charge > 0) {
            const lvl =
              c.charge < SIM.laserChargeSeconds
                ? c.charge / SIM.laserChargeSeconds
                : 1 - Math.max(0, c.cooldown) / SIM.laserCooldownSeconds;
            chg.push([c.cid, Math.max(1, Math.round(lvl * 9))]);
          }
        }
        if (thr.length) s.thr = thr;
        if (chg.length) s.chg = chg;
        const ship = this.shipOf(b);
        if (ship && ship.mirroredUntil > this.tickCount) s.mir = 1;
      }
      bodies.push(s);
    }
    const hooks: HookSnap[] = this.hooks.map((h) => ({ from: h.from.cid, to: h.to.cid, ox: r3(h.ox), oy: r3(h.oy) }));
    const events = this.events;
    this.events = [];
    return { tick: this.tickCount, ring: r3(this.ringRadius), powerup: this.powerupActive, bodies, hooks, events };
  }

  /** Standings as of the moment the fight was decided (or now, if it isn't yet). */
  results(): RoundResultRow[] {
    return this.finalResults ?? this.computeResults();
  }

  private computeResults(): RoundResultRow[] {
    const alive = this.ships.filter((s) => s.alive);
    const dead = this.ships.filter((s) => !s.alive);
    alive.sort((a, b) => aliveCells(b) - aliveCells(a));
    dead.sort((a, b) => (b.deathTick ?? 0) - (a.deathTick ?? 0));
    return [...alive, ...dead].map((s, i) => ({
      playerId: s.playerId,
      place: i + 1,
      kills: s.kills,
      cellsDestroyed: s.cellsDestroyed,
      cellsLost: s.cellsLost,
      survivedSeconds: Math.round(((s.deathTick ?? this.tickCount) / TICK_HZ) * 10) / 10,
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.eventQueue.free();
    this.world.free();
  }

  /** World position of a cell's centre, or null if it isn't attached to a body. */
  cellWorld(c: SimCell): { x: number; y: number } | null {
    const rb = c.body?.rb;
    if (!rb) return null;
    const t = rb.translation();
    return localToWorld(t.x, t.y, rb.rotation(), c.x, c.y);
  }

  /** World-space unit vector a cell points in. */
  cellWorldDir(c: SimCell): { x: number; y: number } {
    const a = c.body?.rb?.rotation() ?? 0;
    const d = DIR_VECTORS[c.dir];
    return { x: d.x * Math.cos(a) - d.y * Math.sin(a), y: d.x * Math.sin(a) + d.y * Math.cos(a) };
  }

  /** Whether a directional part has a clear line out of its own body (covered parts do nothing). */
  isOpen(c: SimCell): boolean {
    const b = c.body;
    if (!b || !c.alive) return false;
    let check = this.openCache.get(b);
    if (!check) {
      check = openChecker(b.cells.filter((x) => x.alive));
      this.openCache.set(b, check);
    }
    return check(c);
  }

  // ---------------------------------------------------------------- bodies & cells

  private newBody(kind: SimBody["kind"], owner: PlayerId | null, x: number, y: number, a: number, vx: number, vy: number, w: number): SimBody {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setRotation(a)
      .setLinvel(vx, vy)
      .setAngvel(w)
      .setLinearDamping(SIM.linearDamping)
      .setAngularDamping(kind === "ship" ? SIM.angularDamping : SIM.angularDamping * 0.3)
      .setCcdEnabled(true);
    const body: SimBody = {
      id: this.nextBodyId++,
      kind,
      owner,
      rb: this.world.createRigidBody(desc),
      cells: [],
      dirty: true,
      sent: false,
      despawnTick: kind === "debris" ? this.tickCount + SIM.debrisLifetimeSeconds * TICK_HZ : Infinity,
      jammedUntil: 0,
    };
    this.bodies.push(body);
    return body;
  }

  private attachCell(body: SimBody, c: SimCell) {
    const desc = RAPIER.ColliderDesc.cuboid(0.5, 0.5)
      .setTranslation(c.x, c.y)
      .setDensity(SIM.cellDensity)
      .setFriction(0.4)
      .setRestitution(c.type === "armor" ? SIM.armorRestitution : 0.2)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(SIM.crushForce);
    const col = this.world.createCollider(desc, body.rb!);
    c.collider = col;
    if (c.type === "saw") {
      const d = DIR_VECTORS[c.dir];
      const blade = this.world.createCollider(
        RAPIER.ColliderDesc.ball(SIM.sawRadius)
          .setTranslation(c.x + d.x * SIM.sawReach, c.y + d.y * SIM.sawReach)
          .setDensity(SIM.cellDensity * 0.2)
          .setFriction(0.1)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body.rb!,
      );
      c.blade = blade;
      this.cellByCollider.set(blade.handle, c);
      this.bladeColliders.add(blade.handle);
    }
    c.body = body;
    body.cells.push(c);
    body.dirty = true;
    this.openCache.delete(body);
    this.cellByCollider.set(col.handle, c);
  }

  private detachCell(c: SimCell) {
    if (c.collider) {
      this.cellByCollider.delete(c.collider.handle);
      this.world.removeCollider(c.collider, true);
      c.collider = null;
    }
    if (c.blade) {
      this.cellByCollider.delete(c.blade.handle);
      this.bladeColliders.delete(c.blade.handle);
      this.world.removeCollider(c.blade, true);
      c.blade = null;
    }
    if (c.body) {
      this.openCache.delete(c.body);
      c.body.cells = c.body.cells.filter((x) => x !== c);
      c.body.dirty = true;
      c.body = null;
    }
  }

  private removeBody(b: SimBody) {
    for (const c of [...b.cells]) {
      this.detachCell(c);
      c.alive = false;
    }
    if (b.rb) this.world.removeRigidBody(b.rb);
    b.rb = null;
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  private shipOf(b: SimBody | null): ShipRecord | undefined {
    if (!b || b.kind !== "ship" || !b.owner) return undefined;
    return this.shipByPlayer.get(b.owner);
  }

  private log(msg: string) {
    this.onLog?.(`[${(this.tickCount / TICK_HZ).toFixed(2)}s t${this.tickCount}] ${msg}`);
  }

  private damageCell(c: SimCell, amount: number, attacker: PlayerId | null, touched: Set<SimBody>, cause: string) {
    if (!c.alive || amount <= 0 || this.endedAt !== null) return;
    const body = c.body;
    const ship = this.shipOf(body);
    if (ship && attacker && attacker !== ship.playerId) ship.lastDamager = attacker;
    c.hp -= amount;
    if (body) body.dirty = true;
    if (c.hp > 0) return;

    const pos = this.cellWorld(c);
    if (pos) this.events.push({ e: "boom", cid: c.cid, x: r3(pos.x), y: r3(pos.y), type: c.type });
    if (this.onLog) {
      const who = ship ? ship.playerId : `debris#${body?.id}`;
      this.log(`${who} lost ${c.type} (${c.x},${c.y}) to ${cause}${attacker ? ` from ${attacker}` : ""}`);
    }
    if (ship) {
      ship.cellsLost++;
      if (attacker && attacker !== ship.playerId) {
        const a = this.shipByPlayer.get(attacker);
        if (a) a.cellsDestroyed++;
      }
    }
    c.alive = false;
    this.detachCell(c);
    if (body) touched.add(body);
  }

  /** After damage: kill ships whose core died, split off disconnected groups as debris. */
  private splitBody(b: SimBody) {
    if (!b.rb) return;
    const ship = this.shipOf(b);
    const alive = b.cells.filter((c) => c.alive);

    if (ship && ship.alive && !ship.core.alive) {
      ship.alive = false;
      ship.deathTick = this.tickCount;
      const killer = ship.lastDamager;
      if (killer) {
        const k = this.shipByPlayer.get(killer);
        if (k) k.kills++;
      }
      this.events.push({ e: "died", playerId: ship.playerId, killerId: killer });
      this.log(`${ship.playerId} DIED (core gone; credited to ${killer ?? "nobody"}); ${alive.length} cells become wreckage`);
      for (const group of components(alive)) this.spawnDebris(b, group);
      this.removeBody(b);
      return;
    }
    if (alive.length === 0) {
      this.removeBody(b);
      return;
    }

    const groups = components(alive);
    if (groups.length <= 1) return;
    let keep: SimCell[];
    if (ship) keep = groups.find((g) => g.includes(ship.core)) ?? groups[0]!;
    else keep = groups.reduce((a, g) => (g.length > a.length ? g : a));
    for (const g of groups) if (g !== keep) this.spawnDebris(b, g);
  }

  private spawnDebris(from: SimBody, group: SimCell[]) {
    const rb = from.rb!;
    const t = rb.translation();
    const a = rb.rotation();
    let sx = 0;
    let sy = 0;
    for (const c of group) {
      sx += c.x;
      sy += c.y;
    }
    const centroid = localToWorld(t.x, t.y, a, sx / group.length, sy / group.length);
    const v = rb.velocityAtPoint(centroid);
    const d = this.newBody("debris", null, t.x, t.y, a, v.x, v.y, rb.angvel());
    for (const c of group) {
      this.detachCell(c);
      this.attachCell(d, c);
      c.thrust = 0;
      c.charge = 0;
    }
    // A little scatter so pieces visibly break away.
    const com = rb.worldCom();
    const ox = centroid.x - com.x;
    const oy = centroid.y - com.y;
    const len = Math.hypot(ox, oy) || 1;
    const k = SIM.debrisScatterImpulse * group.length * (0.5 + this.rng.next());
    d.rb!.applyImpulse({ x: (ox / len) * k, y: (oy / len) * k }, true);
    d.rb!.applyTorqueImpulse((this.rng.next() - 0.5) * group.length * 0.6, true);
  }

  private despawnDebris() {
    for (const b of [...this.bodies]) {
      if (b.kind === "debris" && this.tickCount >= b.despawnTick) this.removeBody(b);
    }
  }

  // ---------------------------------------------------------------- systems

  private applyEngines(ship: ShipRecord, input: InputState) {
    const rb = ship.body.rb;
    if (!rb) return;
    const fired: Record<Dir, boolean> = { 0: input.up, 1: input.right, 2: input.down, 3: input.left };
    const t = rb.translation();
    const a = rb.rotation();
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const ramp = DT / SIM.engineRampSeconds;
    for (const c of ship.body.cells) {
      if (!c.alive || c.type !== "engine") continue;
      c.thrust = fired[c.dir] && this.isOpen(c) ? Math.min(1, c.thrust + ramp) : Math.max(0, c.thrust - ramp * 2);
      if (c.thrust <= 0) continue;
      const d = DIR_VECTORS[c.dir];
      const f = SIM.engineForce * c.thrust * DT;
      const p = { x: t.x + c.x * cos - c.y * sin, y: t.y + c.x * sin + c.y * cos };
      rb.applyImpulseAtPoint({ x: (d.x * cos - d.y * sin) * f, y: (d.x * sin + d.y * cos) * f }, p, true);
    }
  }

  private updateLasers(ship: ShipRecord, input: InputState, touched: Set<SimBody>) {
    const rb = ship.body.rb;
    if (!rb) return;
    for (const c of ship.body.cells) {
      if (!c.alive || c.type !== "laser") continue;
      c.cooldown -= DT;
      // Lasers fire on their own whenever their line is clear.
      if (!this.isOpen(c)) {
        c.charge = 0;
        continue;
      }
      c.charge += DT;
      if (c.charge < SIM.laserChargeSeconds || c.cooldown > 0) continue;
      c.cooldown = SIM.laserCooldownSeconds;
      this.fireLaser(ship, c, touched);
    }
  }

  private fireLaser(ship: ShipRecord, c: SimCell, touched: Set<SimBody>) {
    const rb = ship.body.rb!;
    const o = this.cellWorld(c)!;
    let d = this.cellWorldDir(c);
    let start = { x: o.x + d.x * 0.5, y: o.y + d.y * 0.5 };
    let range = SIM.laserRange;
    // The first segment ignores the shooter; after a mirror bounce the beam can come back at them.
    let exclude: RigidBody | undefined = rb;
    let excludeCollider: Collider | undefined = undefined;
    rb.applyImpulseAtPoint({ x: -d.x * SIM.laserRecoil, y: -d.y * SIM.laserRecoil }, o, true);

    for (let bounce = 0; bounce <= SIM.laserMaxBounces; bounce++) {
      const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(start, d), range, true, undefined, undefined, excludeCollider, exclude);
      const toi = hit ? hit.timeOfImpact : range;
      const end = { x: start.x + d.x * toi, y: start.y + d.y * toi };
      this.events.push({ e: "shot", from: c.cid, x1: r3(start.x), y1: r3(start.y), x2: r3(end.x), y2: r3(end.y), hit: !!hit });
      if (!hit) return;
      const target = this.cellByCollider.get(hit.collider.handle);
      if (!target?.body?.rb) return;

      // A mirror reflects beams that strike its protected edge, taking no damage; a ship with
      // the power-up's mirror skin reflects them off any outer surface.
      const skin = (this.shipOf(target.body)?.mirroredUntil ?? 0) > this.tickCount;
      if (skin || (target.type === "mirror" && this.isOpen(target))) {
        const edge = this.cellWorldDir(target);
        if (skin || -(d.x * edge.x + d.y * edge.y) > SIM.edgeFacingDot) {
          const n = hit.normal;
          const k = 2 * (d.x * n.x + d.y * n.y);
          d = { x: d.x - k * n.x, y: d.y - k * n.y };
          start = end;
          range -= toi;
          exclude = undefined;
          excludeCollider = hit.collider;
          continue;
        }
      }

      target.body.rb.applyImpulseAtPoint({ x: d.x * SIM.laserKnockback, y: d.y * SIM.laserKnockback }, end, true);
      this.damageCell(target, SIM.laserDamage, ship.playerId, touched, "laser");
      return;
    }
  }

  private toggleGrapple(ship: ShipRecord) {
    const mine = this.hooks.filter((h) => h.from.body === ship.body);
    if (mine.length) {
      this.hooks = this.hooks.filter((h) => h.from.body !== ship.body);
      return;
    }
    const rb = ship.body.rb!;
    for (const c of ship.body.cells) {
      if (!c.alive || c.type !== "grapple" || !this.isOpen(c)) continue;
      const o = this.cellWorld(c)!;
      const d = this.cellWorldDir(c);
      const start = { x: o.x + d.x * 0.5, y: o.y + d.y * 0.5 };
      const hit = this.world.castRay(new RAPIER.Ray(start, d), SIM.grappleRange, true, undefined, undefined, undefined, rb);
      if (!hit) {
        const end = { x: start.x + d.x * SIM.grappleRange, y: start.y + d.y * SIM.grappleRange };
        this.events.push({ e: "hookMiss", from: c.cid, x1: r3(start.x), y1: r3(start.y), x2: r3(end.x), y2: r3(end.y) });
        continue;
      }
      const target = this.cellByCollider.get(hit.collider.handle);
      const trb = target?.body?.rb;
      if (!target || !trb) continue;
      const p = { x: start.x + d.x * hit.timeOfImpact, y: start.y + d.y * hit.timeOfImpact };
      // Hook point relative to the target cell centre, in the target body's local frame.
      const tt = trb.translation();
      const ta = trb.rotation();
      const dx = p.x - tt.x;
      const dy = p.y - tt.y;
      const lx = dx * Math.cos(ta) + dy * Math.sin(ta);
      const ly = -dx * Math.sin(ta) + dy * Math.cos(ta);
      this.hooks.push({ from: c, to: target, ox: lx - target.x, oy: ly - target.y, length: hit.timeOfImpact + 0.5 });
    }
  }

  private applyHooks() {
    this.hooks = this.hooks.filter((h) => {
      const ab = h.from.body;
      const bb = h.to.body;
      if (!h.from.alive || !h.to.alive || !ab?.rb || !bb?.rb || ab === bb || ab.kind !== "ship") return false;
      const pa = this.cellWorld(h.from)!;
      const t = bb.rb.translation();
      const pb = localToWorld(t.x, t.y, bb.rb.rotation(), h.to.x + h.ox, h.to.y + h.oy);
      h.length = Math.max(SIM.grappleMinLength, h.length - SIM.grappleRetractSpeed * DT);
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= h.length || dist < 1e-6) return true;
      const nx = dx / dist;
      const ny = dy / dist;
      const va = ab.rb.velocityAtPoint(pa);
      const vb = bb.rb.velocityAtPoint(pb);
      const closing = (vb.x - va.x) * nx + (vb.y - va.y) * ny;
      const f = Math.min(SIM.grappleMaxForce, SIM.grappleStiffness * (dist - h.length) + SIM.grappleDamping * closing);
      if (f <= 0) return true;
      const j = f * DT;
      ab.rb.applyImpulseAtPoint({ x: nx * j, y: ny * j }, pa, true);
      bb.rb.applyImpulseAtPoint({ x: -nx * j, y: -ny * j }, pb, true);
      return true;
    });
  }

  private onCollision(h1: number, h2: number, pre: Map<SimBody, PreVel>, touched: Set<SimBody>) {
    if (this.wallColliders.has(h1) || this.wallColliders.has(h2)) {
      this.onWallHit(this.cellByCollider.get(this.wallColliders.has(h1) ? h2 : h1), pre);
      return;
    }
    const c1 = this.cellByCollider.get(h1);
    const c2 = this.cellByCollider.get(h2);
    const b1 = c1?.body;
    const b2 = c2?.body;
    if (!c1 || !c2 || !b1 || !b2 || b1 === b2) return;
    const key = b1.id < b2.id ? `${b1.id}:${b2.id}` : `${b2.id}:${b1.id}`;
    if ((this.pairCooldown.get(key) ?? -1) > this.tickCount) return;
    const p1 = pre.get(b1);
    const p2 = pre.get(b2);
    if (!p1 || !p2) return;
    const w1 = this.cellWorld(c1)!;
    const w2 = this.cellWorld(c2)!;
    const v1 = pointVel(p1, w1);
    const v2 = pointVel(p2, w2);
    const speed = Math.hypot(v1.x - v2.x, v1.y - v2.y);
    if (speed < SIM.impactThreshold) return;
    if (b1.jammedUntil > this.tickCount || b2.jammedUntil > this.tickCount) return;
    this.pairCooldown.set(key, this.tickCount + Math.round(SIM.impactPairCooldownSeconds * TICK_HZ));

    const base = speed - SIM.impactThreshold;
    // Armor deflects hits on its protected edge: neither cell takes damage, and the armor's bounciness does the rest.
    const deflected = this.armorFacing(c1, w2) || this.armorFacing(c2, w1);
    // One hit each.
    const to1 = deflected ? 0 : 1;
    const to2 = deflected ? 0 : 1;
    const mid = { x: (w1.x + w2.x) / 2, y: (w1.y + w2.y) / 2 };
    this.events.push({ e: "spark", x: r3(mid.x), y: r3(mid.y), power: Math.round(Math.min(9, base)) });
    const owner1 = b1.kind === "ship" ? b1.owner : null;
    const owner2 = b2.kind === "ship" ? b2.owner : null;
    this.damageCell(c1, to1, owner2, touched, `impact at ${speed.toFixed(1)}/s`);
    this.damageCell(c2, to2, owner1, touched, `impact at ${speed.toFixed(1)}/s`);
  }

  private updateRing() {
    if (this.endedAt !== null) return;
    const t = this.tickCount / TICK_HZ - SIM.ringDelaySeconds;
    const f = Math.min(1, Math.max(0, t / SIM.ringShrinkSeconds));
    this.ringRadius = this.ringStart + (SIM.ringMinRadius - this.ringStart) * f;
    this.moveWalls();
  }

  get powerupActive(): boolean {
    return !this.powerupTaken;
  }

  /** The rubber ring: kinematic wall segments the physics engine pushes ships against. */
  private buildWalls() {
    const n = SIM.ringSegments;
    // Long enough to overlap neighbours at the starting radius; they only overlap more as it shrinks.
    const halfLen = ((Math.PI * (this.ringStart + SIM.ringThickness)) / n) * 1.2;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      const r = this.ringStart + SIM.ringThickness / 2;
      const rb = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(Math.cos(angle) * r, Math.sin(angle) * r).setRotation(angle),
      );
      const col = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(SIM.ringThickness / 2, halfLen)
          .setRestitution(SIM.ringRestitution)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setFriction(0.1)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(SIM.crushForce),
        rb,
      );
      this.walls.push({ rb, angle });
      this.wallColliders.add(col.handle);
    }
  }

  private moveWalls() {
    const r = this.ringRadius + SIM.ringThickness / 2;
    for (const w of this.walls) w.rb.setNextKinematicTranslation({ x: Math.cos(w.angle) * r, y: Math.sin(w.angle) * r });
  }

  private onWallHit(c: SimCell | undefined, pre: Map<SimBody, PreVel>) {
    const b = c?.body;
    const p = b && pre.get(b);
    const at = c && this.cellWorld(c);
    if (!b || !p || !at) return;
    const d = Math.hypot(at.x, at.y) || 1;
    const v = pointVel(p, at);
    const vn = (v.x * at.x + v.y * at.y) / d;
    if (vn > 2 && (this.bounceCooldown.get(b) ?? -1) <= this.tickCount) {
      this.bounceCooldown.set(b, this.tickCount + 15);
      this.events.push({ e: "bounce", x: r3((at.x / d) * this.ringRadius), y: r3((at.y / d) * this.ringRadius), power: Math.min(9, Math.round(vn)) });
    }
  }

  /**
   * Called for every contact pushing harder than SIM.crushForce this tick. A pair that stays
   * that hard for SIM.crushSeconds is being crushed (the ring has no slack left), and the
   * touching cells break together. Armor and rams facing the contact hold out, unless both do.
   */
  private onPressure(h1: number, h2: number, force: number, touched: Set<SimBody>) {
    if (force < SIM.crushForce) return;
    const jam = this.tickCount + Math.round(SIM.jamSeconds * TICK_HZ);
    for (const h of [h1, h2]) {
      const b = this.cellByCollider.get(h)?.body;
      if (b) b.jammedUntil = jam;
    }
    const key = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
    const prev = this.pressure.get(key);
    // The force flickers around the threshold while jammed, so tolerate short gaps.
    const ticks = prev && this.tickCount - prev.lastTick <= SIM.crushGapTicks ? prev.ticks + 1 : 1;
    this.pressure.set(key, { ticks, lastTick: this.tickCount });
    const needed = Math.round(SIM.crushSeconds * TICK_HZ);
    if (ticks < needed) return;

    const c1 = this.cellByCollider.get(h1);
    const c2 = this.cellByCollider.get(h2);
    if (!c1 && !c2) return;
    if (!c1 || !c2) {
      // Pressed into the wall itself. Ship-on-ship contacts give way first; this is the
      // fallback for a ship with nothing left to crush against.
      if (ticks < needed * SIM.crushWallFactor) return;
      const c = (c1 ?? c2)!;
      this.pressure.delete(key);
      this.crush(c, touched, "crushed against the ring");
      return;
    }
    if (c1.body === c2.body) return;
    const proof1 = this.crushProof(c1, c2);
    const proof2 = this.crushProof(c2, c1);
    if (proof1 && proof2 && ticks < needed * SIM.crushProofFactor) return;
    this.pressure.delete(key);
    const both = proof1 === proof2;
    if (both || !proof1) this.crush(c1, touched, `crushed against ${c2.body?.owner ?? "debris"}`);
    if (both || !proof2) this.crush(c2, touched, `crushed against ${c1.body?.owner ?? "debris"}`);
  }

  /**
   * Anything that has squeezed out past the ring is crushed, so nothing can wait out the
   * squeeze outside it and every fight ends with one ship or none.
   */
  private crushOutside(touched: Set<SimBody>) {
    const limit = this.ringRadius + SIM.ringThickness + SIM.outsideMargin;
    for (const b of [...this.bodies]) {
      for (const c of [...b.cells]) {
        const p = c.alive ? this.cellWorld(c) : null;
        if (p && p.x * p.x + p.y * p.y > limit * limit) this.crush(c, touched, "outside the ring");
      }
    }
  }

  private trackTouching(h1: number, h2: number, started: boolean) {
    const key = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
    if (!started) {
      this.touching.delete(key);
      return;
    }
    const b1 = this.cellByCollider.get(h1)?.body;
    const b2 = this.cellByCollider.get(h2)?.body;
    if (b1 && b2 && b1 !== b2 && b1.kind === "ship" && b2.kind === "ship") this.touching.set(key, { h1, h2, since: this.tickCount });
  }

  /**
   * Anti-stuck: two ships whose cells have been touching for SIM.stuckSeconds blow up at
   * every such point of contact, on both sides at once.
   */
  private breakStuck(touched: Set<SimBody>) {
    const limit = Math.round(SIM.stuckSeconds * TICK_HZ);
    for (const [key, t] of this.touching) {
      if (this.tickCount - t.since < limit) continue;
      this.touching.delete(key);
      const c1 = this.cellByCollider.get(t.h1);
      const c2 = this.cellByCollider.get(t.h2);
      if (!c1?.alive || !c2?.alive || c1.body?.kind !== "ship" || c2.body?.kind !== "ship" || c1.body === c2.body) continue;
      this.damageCell(c1, c1.hp, null, touched, `stuck to ${c2.body.owner}`);
      this.damageCell(c2, c2.hp, null, touched, `stuck to ${c1.body?.owner ?? "a wreck"}`);
    }
  }

  /** An open armor edge facing the point `at`: it deflects physical hits from there. */
  private armorFacing(a: SimCell, at: { x: number; y: number }): boolean {
    if (a.type !== "armor" || !this.isOpen(a)) return false;
    const wa = this.cellWorld(a);
    if (!wa) return false;
    const edge = this.cellWorldDir(a);
    const dx = at.x - wa.x;
    const dy = at.y - wa.y;
    return (dx * edge.x + dy * edge.y) / (Math.hypot(dx, dy) || 1) > SIM.edgeFacingDot;
  }

  /**
   * Spinning saws cut whatever their blade touches, at any speed, once every SIM.sawCutSeconds
   * while the contact lasts. Armor facing the blade turns it; a covered saw doesn't spin.
   */
  private updateSaws(touched: Set<SimBody>) {
    for (const [key, contact] of this.sawContacts) {
      if (contact.next > this.tickCount) continue;
      const saw = this.cellByCollider.get(contact.blade);
      if (!saw?.alive || !saw.body) {
        this.sawContacts.delete(key);
        continue;
      }
      contact.next = this.tickCount + Math.round(SIM.sawCutSeconds * TICK_HZ);
      // Wall segments and other blades have no cell to cut.
      const target = this.bladeColliders.has(contact.other) ? undefined : this.cellByCollider.get(contact.other);
      if (!target?.alive || target.body === saw.body || !this.isOpen(saw)) continue;
      const hub = this.bladeWorld(saw);
      if (this.armorFacing(target, hub)) continue;
      const at = this.cellWorld(target)!;
      this.events.push({ e: "spark", x: r3((at.x + hub.x) / 2), y: r3((at.y + hub.y) / 2), power: 3 });
      this.damageCell(target, 1, saw.body.owner, touched, "saw");
    }
  }

  private bladeWorld(c: SimCell): { x: number; y: number } {
    const p = this.cellWorld(c)!;
    const d = this.cellWorldDir(c);
    return { x: p.x + d.x * SIM.sawReach, y: p.y + d.y * SIM.sawReach };
  }

  /** An open armor edge or saw pointing at the other cell holds out against crushing. */
  private crushProof(c: SimCell, other: SimCell): boolean {
    if ((c.type !== "armor" && c.type !== "saw") || !this.isOpen(c)) return false;
    const a = this.cellWorld(c);
    const b = this.cellWorld(other);
    if (!a || !b) return false;
    const edge = this.cellWorldDir(c);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return (dx * edge.x + dy * edge.y) / (Math.hypot(dx, dy) || 1) > SIM.edgeFacingDot;
  }

  private crush(c: SimCell, touched: Set<SimBody>, cause: string) {
    if (!c.alive) return;
    const pos = this.cellWorld(c);
    if (pos) this.events.push({ e: "spark", x: r3(pos.x), y: r3(pos.y), power: 5 });
    this.damageCell(c, c.hp, null, touched, cause);
  }

  private updatePowerup() {
    if (this.powerupTaken) return;
    const r2 = SIM.powerupPickupRadius * SIM.powerupPickupRadius;
    for (const ship of this.ships) {
      if (!ship.alive) continue;
      const near = ship.body.cells.some((c) => {
        const p = c.alive ? this.cellWorld(c) : null;
        return !!p && p.x * p.x + p.y * p.y < r2;
      });
      if (!near) continue;
      ship.mirroredUntil = this.tickCount + Math.round(SIM.mirrorSkinSeconds * TICK_HZ);
      this.powerupTaken = true;
      this.events.push({ e: "pickup", playerId: ship.playerId });
      this.log(`${ship.playerId} took the power-up`);
      return;
    }
  }

}

function pointVel(p: PreVel, at: { x: number; y: number }) {
  const rx = at.x - p.cx;
  const ry = at.y - p.cy;
  return { x: p.vx - p.w * ry, y: p.vy + p.w * rx };
}

function aliveCells(s: ShipRecord): number {
  return s.body.cells.filter((c) => c.alive).length;
}

/** 4-connected groups of cells by grid position. */
function components(cells: SimCell[]): SimCell[][] {
  const byPos = new Map<string, SimCell>();
  for (const c of cells) byPos.set(`${c.x},${c.y}`, c);
  const seen = new Set<SimCell>();
  const groups: SimCell[][] = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const group: SimCell[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const c = stack.pop()!;
      group.push(c);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const n = byPos.get(`${c.x + dx},${c.y + dy}`);
        if (n && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
