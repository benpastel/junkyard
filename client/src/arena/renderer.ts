// Canvas 2D arena renderer. Consumes snapshots, interpolates ~100ms behind the
// newest one, and draws ships, effects, the rubber ring and the power-up. No React in here.
import type { PlayerId } from "@ja/shared";
import {
  TICK_HZ,
  lerpAngle,
  localToWorld,
  type ArenaEvent,
  type ArenaInit,
  type ArenaSnapshot,
  type BodySnap,
  type InitCell,
} from "@ja/shared/sim/view";
import { openChecker } from "@ja/shared";
import { drawCellPart, drawCellPlate, type CellStyle } from "../art/cells";

/** Where the engine bell ends and the laser barrel tip sits, in cells from the cell centre (see art/cells.ts). */
const NOZZLE_END = 0.67;
const BARREL_TIP = 0.97;

/** Seconds the view lags behind the newest snapshot, so there's always a pair to interpolate between. */
const RENDER_DELAY = 0.1;
/** Visible width of the world at the default zoom, in cells. */
const VIEW_CELLS = 38;

interface CellInfo extends InitCell {
  color: string;
}

interface Particle {
  kind: "spark" | "chunk" | "smoke" | "flash" | "ring";
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
}

interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  max: number;
  color: string;
  width: number;
}

interface BodyView {
  x: number;
  y: number;
  a: number;
  owner: PlayerId | null;
  snap: BodySnap;
}

interface Star {
  x: number;
  y: number;
  r: number;
  b: number;
}

export class ArenaRenderer {
  private readonly cellInfo = new Map<number, CellInfo>();
  private readonly shipInfo = new Map<PlayerId, { name: string; color: string; bodyId: number }>();
  /** Snapshots not yet passed by render time, oldest first. */
  private buffer: ArenaSnapshot[] = [];
  /** The newest snapshot at or before render time. */
  private current: ArenaSnapshot | null = null;
  private readonly bodyCells = new Map<number, { cells: number[]; dmg: number[] }>();
  private readonly cidBody = new Map<number, number>();
  private readonly lastShipPos = new Map<PlayerId, { x: number; y: number }>();
  private readonly dead = new Set<PlayerId>();
  private clockOffset: number | null = null;
  private particles: Particle[] = [];
  private beams: Beam[] = [];
  private camera = { x: 0, y: 0, zoom: 1 };
  /** Fixed view rotation so my ship starts pointing up the screen. */
  private camRot: number | null = null;
  private cameraReady = false;
  private shake = 0;
  private lastFrame = 0;
  private readonly stars: Star[][];
  private fxSeed = 1;

  constructor(
    private readonly init: ArenaInit,
    private readonly me: PlayerId | null,
  ) {
    for (const s of init.ships) {
      this.shipInfo.set(s.playerId, { name: s.name, color: s.color, bodyId: s.bodyId });
      for (const c of s.cells) this.cellInfo.set(c.cid, { ...c, color: s.color });
      this.bodyCells.set(s.bodyId, { cells: s.cells.map((c) => c.cid), dmg: s.cells.map(() => 0) });
      for (const c of s.cells) this.cidBody.set(c.cid, s.bodyId);
    }
    this.stars = [0.15, 0.35, 0.6].map((depth, layer) => {
      const out: Star[] = [];
      for (let i = 0; i < 140 - layer * 30; i++) {
        out.push({ x: this.fx(), y: this.fx(), r: (0.4 + this.fx() * 0.9) * (0.7 + depth), b: 0.25 + this.fx() * 0.55 * (1 - depth * 0.5) });
      }
      return out;
    });
  }

  push(snap: ArenaSnapshot) {
    const now = performance.now() / 1000;
    const sample = now - snap.tick / TICK_HZ;
    // Track the smallest observed offset (least network delay), drifting up slowly in case the clock moves.
    if (this.clockOffset === null || sample < this.clockOffset) this.clockOffset = sample;
    else this.clockOffset += (sample - this.clockOffset) * 0.01;
    this.buffer.push(snap);
  }

  /** Alive ship colours in spawn order; dead ones are null. */
  shipPips(): { color: string; alive: boolean }[] {
    return this.init.ships.map((s) => ({ color: s.color, alive: !this.dead.has(s.playerId) }));
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number) {
    const nowMs = performance.now();
    const dt = this.lastFrame ? Math.min(0.05, (nowMs - this.lastFrame) / 1000) : 0;
    this.lastFrame = nowMs;

    const renderTick = this.renderTick(nowMs / 1000);
    this.consume(renderTick);
    const bodies = this.interpolate(renderTick);
    const ring = this.ringAt(renderTick);

    this.updateCamera(bodies, width, height, dt);
    this.tickEffects(dt);

    const S = (Math.min(width, height * 1.4) / VIEW_CELLS) * this.camera.zoom;
    const shakeX = this.shake > 0 ? (Math.sin(nowMs * 0.09) * this.shake * S) / 3 : 0;
    const shakeY = this.shake > 0 ? (Math.cos(nowMs * 0.11) * this.shake * S) / 3 : 0;
    const rot = this.camRot ?? 0;
    const rc = Math.cos(rot);
    const rs = Math.sin(rot);
    const toScreen = (x: number, y: number) => {
      const dx = x - this.camera.x;
      const dy = y - this.camera.y;
      return { x: width / 2 + (dx * rc - dy * rs) * S + shakeX, y: height / 2 + (dx * rs + dy * rc) * S + shakeY };
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawBackdrop(ctx, width, height, S);
    this.drawGrid(ctx, width, height, S, toScreen);
    this.drawRing(ctx, width, height, S, ring, toScreen, nowMs);
    this.drawPowerup(ctx, S, toScreen, nowMs);

    // Debris under ships.
    const sorted = [...bodies].sort((a, b) => (a.owner ? 1 : 0) - (b.owner ? 1 : 0));
    for (const b of sorted) this.drawBody(ctx, b, S, toScreen, nowMs);
    for (const b of bodies) if (b.owner) this.drawEngines(ctx, b, S, toScreen, nowMs);
    this.drawHooks(ctx, bodies, S, toScreen);
    for (const b of bodies) if (b.owner) this.drawCharge(ctx, b, S, toScreen, nowMs);
    for (const b of bodies) if (b.snap.inv) this.drawShield(ctx, b, S, toScreen, nowMs);
    this.drawBeams(ctx, S, toScreen);
    this.drawParticles(ctx, S, toScreen);
    this.drawNames(ctx, bodies, S, toScreen);
  }

  // ---------------------------------------------------------------- timing

  private renderTick(nowSec: number): number {
    if (this.clockOffset === null) return 0;
    return (nowSec - this.clockOffset - RENDER_DELAY) * TICK_HZ;
  }

  /** Apply every snapshot whose tick has been reached: cell lists and events. */
  private consume(renderTick: number) {
    while (this.buffer.length && (this.buffer[0]!.tick <= renderTick || this.buffer.length > 12)) {
      const snap = this.buffer.shift()!;
      for (const b of snap.bodies) {
        if (b.cells) {
          this.bodyCells.set(b.id, { cells: b.cells, dmg: b.dmg ?? b.cells.map(() => 0) });
          for (const cid of b.cells) this.cidBody.set(cid, b.id);
        }
        if (b.owner) this.lastShipPos.set(b.owner, { x: b.x, y: b.y });
      }
      for (const e of snap.events) this.onEvent(e);
      this.current = snap;
    }
  }

  private interpolate(renderTick: number): BodyView[] {
    const a = this.current;
    if (!a) return [];
    const b = this.buffer[0];
    const out: BodyView[] = [];
    if (b) {
      const t = Math.max(0, Math.min(1, (renderTick - a.tick) / Math.max(1, b.tick - a.tick)));
      const next = new Map(b.bodies.map((x) => [x.id, x]));
      for (const s of a.bodies) {
        const n = next.get(s.id);
        if (n) out.push({ x: s.x + (n.x - s.x) * t, y: s.y + (n.y - s.y) * t, a: lerpAngle(s.a, n.a, t), owner: s.owner, snap: s });
        else out.push({ x: s.x, y: s.y, a: s.a, owner: s.owner, snap: s });
      }
    } else {
      // Starved: extrapolate briefly with velocity.
      const dt = Math.max(0, Math.min(0.2, (renderTick - a.tick) / TICK_HZ));
      for (const s of a.bodies) out.push({ x: s.x + s.vx * dt, y: s.y + s.vy * dt, a: s.a + s.w * dt, owner: s.owner, snap: s });
    }
    return out;
  }

  private ringAt(renderTick: number): number {
    const a = this.current;
    if (!a) return this.init.ring.startRadius;
    const b = this.buffer[0];
    if (!b) return a.ring;
    const t = Math.max(0, Math.min(1, (renderTick - a.tick) / Math.max(1, b.tick - a.tick)));
    return a.ring + (b.ring - a.ring) * t;
  }

  // ---------------------------------------------------------------- camera

  private updateCamera(bodies: BodyView[], width: number, height: number, dt: number) {
    let focus: BodyView | undefined;
    if (this.me && !this.dead.has(this.me)) focus = bodies.find((b) => b.owner === this.me);
    if (!focus) {
      // Spectate the ship with the most cells.
      let best = -1;
      for (const b of bodies) {
        if (!b.owner) continue;
        const n = this.bodyCells.get(b.snap.id)?.cells.length ?? 0;
        if (n > best) {
          best = n;
          focus = b;
        }
      }
    }
    if (this.camRot === null && this.current) {
      const mine = this.me ? bodies.find((b) => b.owner === this.me) : undefined;
      this.camRot = mine ? -mine.a : 0;
    }
    const target = focus ? { x: focus.x, y: focus.y } : { x: 0, y: 0 };
    // No live ship to follow (spectating with nothing left): frame the whole ring.
    const targetZoom = focus ? 1 : Math.min(1, VIEW_CELLS / (this.init.ring.startRadius * 2.2) / Math.min(1, width / (height * 1.4)));
    if (!this.cameraReady && (focus || this.current)) {
      this.camera = { x: target.x, y: target.y, zoom: targetZoom };
      this.cameraReady = true;
    }
    const k = 1 - Math.exp(-dt * 6);
    this.camera.x += (target.x - this.camera.x) * k;
    this.camera.y += (target.y - this.camera.y) * k;
    this.camera.zoom += (targetZoom - this.camera.zoom) * (1 - Math.exp(-dt * 2));
  }

  // ---------------------------------------------------------------- events & effects

  private onEvent(e: ArenaEvent) {
    switch (e.e) {
      case "shot": {
        const color = this.cellInfo.get(e.from)?.color ?? "#ff6040";
        // The sim fires from the cell's edge; start the visible beam at the barrel tip when it's that long.
        const len = Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
        const skip = this.cellInfo.get(e.from)?.type === "laser" && len > BARREL_TIP ? (BARREL_TIP - 0.5) / len : 0;
        const x1 = e.x1 + (e.x2 - e.x1) * skip;
        const y1 = e.y1 + (e.y2 - e.y1) * skip;
        this.beams.push({ x1, y1, x2: e.x2, y2: e.y2, life: 0.1, max: 0.1, color, width: 0.12 });
        if (e.hit) this.burst(e.x2, e.y2, 3, "#ffd9a0", 3, 0.2);
        break;
      }
      case "hookMiss":
        this.beams.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, life: 0.25, max: 0.25, color: "#9aa0a6", width: 0.08 });
        break;
      case "boom": {
        const info = this.cellInfo.get(e.cid);
        this.burst(e.x, e.y, 10, "#ffb060", 6, 0.45);
        this.particles.push({ kind: "flash", x: e.x, y: e.y, vx: 0, vy: 0, life: 0.18, max: 0.18, size: 1.6, color: "#ffe0b0", rot: 0, vr: 0 });
        for (let i = 0; i < 3; i++) {
          this.particles.push({
            kind: "chunk",
            x: e.x,
            y: e.y,
            vx: (this.fx() - 0.5) * 6,
            vy: (this.fx() - 0.5) * 6,
            life: 1.2 + this.fx(),
            max: 2.2,
            size: 0.18 + this.fx() * 0.22,
            color: i === 0 ? (info?.color ?? "#888") : "#5a5c5f",
            rot: this.fx() * 6,
            vr: (this.fx() - 0.5) * 12,
          });
        }
        for (let i = 0; i < 3; i++) {
          this.particles.push({ kind: "smoke", x: e.x, y: e.y, vx: (this.fx() - 0.5) * 1.5, vy: (this.fx() - 0.5) * 1.5, life: 1.2, max: 1.2, size: 0.6 + this.fx() * 0.6, color: "#2a2522", rot: 0, vr: 0 });
        }
        if (this.isNearCamera(e.x, e.y)) this.shake = Math.min(1.2, this.shake + 0.25);
        break;
      }
      case "spark":
        this.burst(e.x, e.y, 4 + e.power * 2, "#fff0c0", 5 + e.power, 0.3);
        if (e.power >= 3 && this.isNearCamera(e.x, e.y)) this.shake = Math.min(1.2, this.shake + 0.1 * e.power);
        break;
      case "bounce":
        this.wobbles.push({ a: Math.atan2(e.y, e.x), power: e.power, life: 1 });
        this.burst(e.x, e.y, 3 + e.power, "#c9ced4", 3 + e.power * 0.5, 0.25);
        break;
      case "pickup":
        this.particles.push({ kind: "ring", x: 0, y: 0, vx: 0, vy: 0, life: 0.5, max: 0.5, size: 4, color: "#8cf0ff", rot: 0, vr: 0 });
        this.burst(0, 0, 24, "#bff6ff", 8, 0.5);
        break;
      case "died": {
        this.dead.add(e.playerId);
        const p = this.lastShipPos.get(e.playerId);
        if (p) {
          this.burst(p.x, p.y, 40, "#ffb060", 10, 0.8);
          this.particles.push({ kind: "ring", x: p.x, y: p.y, vx: 0, vy: 0, life: 0.6, max: 0.6, size: 7, color: "#ffcf8a", rot: 0, vr: 0 });
          this.particles.push({ kind: "flash", x: p.x, y: p.y, vx: 0, vy: 0, life: 0.3, max: 0.3, size: 5, color: "#fff2d8", rot: 0, vr: 0 });
          if (this.isNearCamera(p.x, p.y)) this.shake = 1.5;
        }
        break;
      }
    }
  }

  private isNearCamera(x: number, y: number) {
    return Math.hypot(x - this.camera.x, y - this.camera.y) < VIEW_CELLS * 0.7;
  }

  private burst(x: number, y: number, n: number, color: string, speed: number, life: number) {
    for (let i = 0; i < n; i++) {
      const a = this.fx() * Math.PI * 2;
      const v = speed * (0.3 + this.fx() * 0.7);
      this.particles.push({ kind: "spark", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.5 + this.fx() * 0.5), max: life, size: 0.07 + this.fx() * 0.06, color, rot: 0, vr: 0 });
    }
  }

  private tickEffects(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = p.kind === "chunk" ? 0.6 : 2.5;
      p.vx *= Math.exp(-drag * dt);
      p.vy *= Math.exp(-drag * dt);
      p.rot += p.vr * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
    this.shake = Math.max(0, this.shake - dt * 3);
    for (const wb of this.wobbles) wb.life -= dt * 1.8;
    this.wobbles = this.wobbles.filter((wb) => wb.life > 0);
  }

  /** Cosmetic randomness only; never touches the sim. */
  private fx(): number {
    this.fxSeed = (this.fxSeed * 16807) % 2147483647;
    return (this.fxSeed - 1) / 2147483646;
  }

  // ---------------------------------------------------------------- drawing

  private drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, S: number) {
    ctx.fillStyle = "#06080b";
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w * 0.7, h * 0.2, 0, w * 0.7, h * 0.2, Math.max(w, h) * 0.8);
    g.addColorStop(0, "rgba(60,38,24,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const tile = 900;
    const rot = this.camRot ?? 0;
    const camX = this.camera.x * Math.cos(rot) - this.camera.y * Math.sin(rot);
    const camY = this.camera.x * Math.sin(rot) + this.camera.y * Math.cos(rot);
    this.stars.forEach((layer, i) => {
      const depth = [0.15, 0.35, 0.6][i]!;
      const ox = -camX * S * depth;
      const oy = -camY * S * depth;
      for (const s of layer) {
        let x = (s.x * tile + ox) % tile;
        let y = (s.y * tile + oy) % tile;
        if (x < 0) x += tile;
        if (y < 0) y += tile;
        for (let tx = x; tx < w; tx += tile) {
          for (let ty = y; ty < h; ty += tile) {
            ctx.fillStyle = `rgba(220,215,200,${s.b})`;
            ctx.fillRect(tx, ty, s.r, s.r);
          }
        }
      }
    });
  }

  private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, S: number, toScreen: (x: number, y: number) => { x: number; y: number }) {
    const step = 5;
    const halfW = Math.hypot(w, h) / 2 / S + step;
    const halfH = halfW;
    const x0 = Math.floor((this.camera.x - halfW) / step) * step;
    const y0 = Math.floor((this.camera.y - halfH) / step) * step;
    ctx.fillStyle = "rgba(160,150,130,0.12)";
    for (let x = x0; x < this.camera.x + halfW; x += step) {
      for (let y = y0; y < this.camera.y + halfH; y += step) {
        const p = toScreen(x, y);
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
    }
  }

  /** Bounce dents travelling round the rubber ring: angle, strength, seconds left. */
  private wobbles: { a: number; power: number; life: number }[] = [];

  private drawRing(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    S: number,
    ring: number,
    toScreen: (x: number, y: number) => { x: number; y: number },
    nowMs: number,
  ) {
    const c = toScreen(0, 0);
    const rot = this.camRot ?? 0;
    const t = nowMs / 1000;
    // Radius at a world angle, dented outward where something just bounced.
    const radiusAt = (a: number) => {
      let r = ring;
      for (const wb of this.wobbles) {
        const d = Math.atan2(Math.sin(a - wb.a), Math.cos(a - wb.a));
        r += wb.power * 0.12 * wb.life * Math.exp(-(d * d) / 0.02) * Math.cos(t * 28);
      }
      return r;
    };
    const N = 220;
    const path = (offset: number) => {
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const r = (radiusAt(a) + offset) * S;
        const x = c.x + Math.cos(a + rot) * r;
        const y = c.y + Math.sin(a + rot) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    // Dim everything outside the ring.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(c.x, c.y, (ring + 0.9) * S, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fill("evenodd");
    ctx.restore();

    // The rubber bumper: a thick dark tube with a soft highlight on its inner face.
    ctx.save();
    ctx.lineJoin = "round";
    path(0.45);
    ctx.strokeStyle = "#1a1b1e";
    ctx.lineWidth = 0.9 * S;
    ctx.stroke();
    path(0.25);
    ctx.strokeStyle = "#2c2e33";
    ctx.lineWidth = 0.45 * S;
    ctx.stroke();
    path(0.08);
    ctx.strokeStyle = "rgba(170,175,185,0.35)";
    ctx.lineWidth = Math.max(1, 0.08 * S);
    ctx.stroke();
    ctx.restore();
  }

  private drawPowerup(ctx: CanvasRenderingContext2D, S: number, toScreen: (x: number, y: number) => { x: number; y: number }, nowMs: number) {
    if (!this.current?.powerup) return;
    const p = toScreen(0, 0);
    const t = nowMs / 1000;
    const r = (0.55 + 0.08 * Math.sin(t * 5)) * S;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
    g.addColorStop(0, "rgba(140,240,255,0.55)");
    g.addColorStop(1, "rgba(140,240,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8fdff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(140,240,255,0.9)";
    ctx.lineWidth = Math.max(1, 0.1 * S);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, t * 3, t * 3 + Math.PI * 1.4);
    ctx.stroke();
    ctx.restore();
  }

  /** Shimmering bubble around an invulnerable ship. */
  private drawShield(ctx: CanvasRenderingContext2D, b: BodyView, S: number, toScreen: (x: number, y: number) => { x: number; y: number }, nowMs: number) {
    const cells = this.bodyCells.get(b.snap.id);
    if (!cells) return;
    let reach = 0;
    for (const cid of cells.cells) {
      const c = this.cellInfo.get(cid);
      if (c) reach = Math.max(reach, Math.hypot(c.x, c.y));
    }
    const p = toScreen(b.x, b.y);
    const r = (reach + 1.2) * S;
    const k = 0.5 + 0.5 * Math.sin(nowMs / 90);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r);
    g.addColorStop(0, "rgba(140,240,255,0)");
    g.addColorStop(1, `rgba(140,240,255,${0.18 + 0.12 * k})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(190,248,255,${0.5 + 0.3 * k})`;
    ctx.lineWidth = Math.max(1, 0.07 * S);
    ctx.stroke();
    ctx.restore();
  }

  /** Open-line checkers per alive-cell list; a new list arrives whenever a body's cells change. */
  private openCheckers = new WeakMap<readonly number[], ReturnType<typeof openChecker>>();

  private openCheckerFor(cids: readonly number[]) {
    let check = this.openCheckers.get(cids);
    if (!check) {
      check = openChecker(cids.flatMap((cid) => this.cellInfo.get(cid) ?? []));
      this.openCheckers.set(cids, check);
    }
    return check;
  }

  private drawBody(ctx: CanvasRenderingContext2D, b: BodyView, S: number, toScreen: (x: number, y: number) => { x: number; y: number }, nowMs: number) {
    const cells = this.bodyCells.get(b.snap.id);
    if (!cells) return;
    const p = toScreen(b.x, b.y);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(b.a + (this.camRot ?? 0));
    const debris = !b.owner;
    // Wreckage (dead ships, broken-off chunks) is dark and see-through so it never reads as a live, damaged ship.
    if (debris) ctx.globalAlpha = 0.45;
    // Drop shadow so ships read against the backdrop.
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    for (const cid of cells.cells) {
      const c = this.cellInfo.get(cid);
      if (c) ctx.fillRect((c.x - 0.5) * S + S * 0.12, (c.y - 0.5) * S + S * 0.12, S, S);
    }
    const isOpen = this.openCheckerFor(cells.cells);
    const style = (c: CellInfo, i: number): CellStyle => ({
      color: debris ? "#3a3836" : c.color,
      damage: debris ? 0 : (cells.dmg[i] ?? 0) / 9,
      variant: c.cid,
      inactive: debris || !isOpen(c),
      // Engines are drawn off; drawEngines adds the flame while they fire.
      thrusting: false,
      time: nowMs / 1000,
    });
    // Two passes: parts overhang their square, so they go on top of every plate.
    for (const pass of [drawCellPlate, null] as const) {
      cells.cells.forEach((cid, i) => {
        const c = this.cellInfo.get(cid);
        if (!c) return;
        ctx.save();
        ctx.translate((c.x - 0.5) * S, (c.y - 0.5) * S);
        if (pass) pass(ctx, S, style(c, i));
        else drawCellPart(ctx, c.type, c.dir, S, style(c, i));
        ctx.restore();
      });
    }
    ctx.restore();
  }

  private drawEngines(ctx: CanvasRenderingContext2D, b: BodyView, S: number, toScreen: (x: number, y: number) => { x: number; y: number }, nowMs: number) {
    if (!b.snap.thr) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [cid, level] of b.snap.thr) {
      const c = this.cellInfo.get(cid);
      if (!c) continue;
      const lv = level / 9;
      // Nozzle sits on the side opposite the push direction.
      const dirA = (c.dir * Math.PI) / 2 + b.a;
      const back = { x: -Math.sin(dirA), y: Math.cos(dirA) };
      const base = localToWorld(b.x, b.y, b.a, c.x, c.y);
      const flicker = 0.8 + 0.2 * Math.sin(nowMs * 0.05 + cid * 1.7);
      const len = (0.5 + lv * 1.3) * flicker;
      const start = toScreen(base.x + back.x * NOZZLE_END, base.y + back.y * NOZZLE_END);
      const end = toScreen(base.x + back.x * (NOZZLE_END + len), base.y + back.y * (NOZZLE_END + len));
      const grad = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
      grad.addColorStop(0, `rgba(255,240,200,${0.9 * lv})`);
      grad.addColorStop(0.35, `rgba(255,160,60,${0.75 * lv})`);
      grad.addColorStop(1, "rgba(255,60,20,0)");
      ctx.strokeStyle = grad;
      ctx.lineCap = "round";
      ctx.lineWidth = S * 0.42;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.lineWidth = S * 0.18;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCharge(ctx: CanvasRenderingContext2D, b: BodyView, S: number, toScreen: (x: number, y: number) => { x: number; y: number }, nowMs: number) {
    if (!b.snap.chg) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [cid, level] of b.snap.chg) {
      const c = this.cellInfo.get(cid);
      if (!c) continue;
      const dirA = (c.dir * Math.PI) / 2 + b.a;
      const fwd = { x: Math.sin(dirA), y: -Math.cos(dirA) };
      const base = localToWorld(b.x, b.y, b.a, c.x, c.y);
      const p = toScreen(base.x + fwd.x * BARREL_TIP, base.y + fwd.y * BARREL_TIP);
      const r = S * (0.15 + (level / 9) * 0.35) * (0.9 + 0.1 * Math.sin(nowMs * 0.04));
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2);
      grad.addColorStop(0, "rgba(255,230,220,0.95)");
      grad.addColorStop(0.3, `${c.color}cc`);
      grad.addColorStop(1, "rgba(255,40,20,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawHooks(ctx: CanvasRenderingContext2D, bodies: BodyView[], S: number, toScreen: (x: number, y: number) => { x: number; y: number }) {
    const hooks = this.current?.hooks;
    if (!hooks?.length) return;
    const byId = new Map(bodies.map((b) => [b.snap.id, b]));
    for (const h of hooks) {
      const fromBody = byId.get(this.cidBody.get(h.from) ?? -1);
      const toBody = byId.get(this.cidBody.get(h.to) ?? -1);
      const fc = this.cellInfo.get(h.from);
      const tc = this.cellInfo.get(h.to);
      if (!fromBody || !toBody || !fc || !tc) continue;
      const a = toScreen(...xy(localToWorld(fromBody.x, fromBody.y, fromBody.a, fc.x, fc.y)));
      const b = toScreen(...xy(localToWorld(toBody.x, toBody.y, toBody.a, tc.x + h.ox, tc.y + h.oy)));
      ctx.save();
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = S * 0.16;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = "#b9b2a4";
      ctx.lineWidth = S * 0.08;
      ctx.setLineDash([S * 0.2, S * 0.12]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = fc.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, S * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawBeams(ctx: CanvasRenderingContext2D, S: number, toScreen: (x: number, y: number) => { x: number; y: number }) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const b of this.beams) {
      const f = b.life / b.max;
      const p1 = toScreen(b.x1, b.y1);
      const p2 = toScreen(b.x2, b.y2);
      ctx.strokeStyle = withAlpha(b.color, 0.35 * f);
      ctx.lineWidth = b.width * S * 3;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,245,230,${0.95 * f})`;
      ctx.lineWidth = b.width * S * 0.8;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, S: number, toScreen: (x: number, y: number) => { x: number; y: number }) {
    for (const p of this.particles) {
      const f = Math.max(0, p.life / p.max);
      const s = toScreen(p.x, p.y);
      ctx.save();
      switch (p.kind) {
        case "spark":
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = withAlpha(p.color, f);
          ctx.lineWidth = p.size * S;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x - p.vx * 0.03 * S, s.y - p.vy * 0.03 * S);
          ctx.stroke();
          break;
        case "chunk":
          ctx.translate(s.x, s.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = Math.min(1, f * 2);
          ctx.fillStyle = p.color;
          ctx.fillRect((-p.size * S) / 2, (-p.size * S) / 2, p.size * S, p.size * S);
          break;
        case "smoke":
          ctx.globalAlpha = f * 0.5;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(s.x, s.y, p.size * S * (1.6 - f * 0.6), 0, Math.PI * 2);
          ctx.fill();
          break;
        case "flash": {
          ctx.globalCompositeOperation = "lighter";
          const r = p.size * S * (1.2 - f * 0.4);
          const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
          g.addColorStop(0, withAlpha(p.color, f));
          g.addColorStop(1, "rgba(255,120,40,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "ring":
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = withAlpha(p.color, f * 0.8);
          ctx.lineWidth = S * 0.3 * f;
          ctx.beginPath();
          ctx.arc(s.x, s.y, p.size * S * (1 - f) + S, 0, Math.PI * 2);
          ctx.stroke();
          break;
      }
      ctx.restore();
    }
  }

  private drawNames(ctx: CanvasRenderingContext2D, bodies: BodyView[], S: number, toScreen: (x: number, y: number) => { x: number; y: number }) {
    ctx.save();
    ctx.font = `600 ${Math.max(11, Math.round(S * 0.42))}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const b of bodies) {
      if (!b.owner || b.owner === this.me) continue;
      const info = this.shipInfo.get(b.owner);
      const cells = this.bodyCells.get(b.snap.id);
      if (!info || !cells) continue;
      // Place the label above the ship's screen-space bounding box.
      let minY = Infinity;
      let sumX = 0;
      for (const cid of cells.cells) {
        const c = this.cellInfo.get(cid);
        if (!c) continue;
        const w = localToWorld(b.x, b.y, b.a, c.x, c.y);
        const sp = toScreen(w.x, w.y);
        minY = Math.min(minY, sp.y);
        sumX += sp.x;
      }
      if (!cells.cells.length) continue;
      const p = { x: sumX / cells.cells.length, y: minY - S * 0.9 };
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(info.name, p.x + 1, p.y + 1);
      ctx.fillStyle = info.color;
      ctx.fillText(info.name, p.x, p.y);
    }
    ctx.restore();
  }
}

function xy(p: { x: number; y: number }): [number, number] {
  return [p.x, p.y];
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  return color;
}
