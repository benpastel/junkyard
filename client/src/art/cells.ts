// Ship cell art, shared by the draft screen and the arena.
// Style: junk plates + parts that stick out past their cell in their working direction,
// so a part's silhouette (not a tiny glyph) says what it is and which way it points.
//
// Overhang means draw order matters: draw every cell's plate first, then every cell's part,
// or later plates paint over earlier overhangs. drawCell does both for one-off cells
// (piece previews etc); ship renderers should call drawCellPlate / drawCellPart in two passes.
import type { CellType, Dir } from "@ja/shared";

export interface CellStyle {
  /** Player colour, used for the cockpit. */
  color: string;
  /** 0 = pristine, 1 = about to fall off. */
  damage?: number;
  /** Stable per-cell number; varies plate colour, rust, and damage cracks. */
  variant?: number;
  /** Covered by the ship's own hull, so the part does nothing. */
  inactive?: boolean;
  /** Engine is firing right now. Omit to always show the flame (draft screen). */
  thrusting?: boolean;
  /** Seconds, for spinning saws and flickering flames. Omit for a still blade. */
  time?: number;
  /**
   * Mirrors: which sides get a reflective strip, as a bitmask over ship-frame dirs (bit 0 = up,
   * 1 = right, 2 = down, 3 = left). Omit for all four. See mirrorSidesOf.
   */
  openSides?: number;
}

/**
 * For each cell of a ship (or piece), the sides a mirror (or armor) strip is drawn on. Sides buried against
 * hull or other parts still show, since they start reflecting the moment whatever covers them
 * breaks off. Edges inside one piece are left plain; where two different mirror pieces meet, the
 * shared edge is drawn once (on the cell to its left or above it).
 */
export function mirrorSidesOf(
  cells: readonly { x: number; y: number; type: CellType; piece?: number }[],
): (c: { x: number; y: number; piece?: number }) => number {
  // Coats (mirror, armor) by square.
  const coats = new Map<string, CellType>();
  const pieceAt = new Map<string, number | undefined>();
  for (const c of cells) {
    pieceAt.set(`${c.x},${c.y}`, c.piece);
    if (c.type === "mirror" || c.type === "armor") coats.set(`${c.x},${c.y}`, c.type);
  }
  const typeAt = new Map(cells.map((c) => [`${c.x},${c.y}`, c.type]));
  const NEIGHBOURS = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const;
  return (c) => {
    let sides = 0;
    const own = typeAt.get(`${c.x},${c.y}`);
    NEIGHBOURS.forEach(([dx, dy], side) => {
      const key = `${c.x + dx},${c.y + dy}`;
      // Inside one piece (the coat or a part sharing the piece) the edge stays plain, so the strips
      // trace the piece's outline; against another piece of the same coat, draw the shared edge once.
      const samePiece = pieceAt.has(key) && pieceAt.get(key) === c.piece;
      const draw = !samePiece && (coats.get(key) !== own || side === 1 || side === 2);
      if (draw) sides |= 1 << side;
    });
    return sides;
  };
}

const EDGE = "#24272c";
const DARK = "#1c1e22";
const TAPE = "#b9b29a";
export const METAL = "#c9ced4";
export const METAL_DARK = "#7d838b";
export const NEON = "#f2ea3c";
export const HOT = "#ff8a2a";
const YEL = "#ffe08a";
const PLATES = ["#4a4038", "#3b3f46", "#46473c", "#3a4148", "#4a3f3f"];

/** One cell's plate (+ damage) filling (0,0)-(size,size). */
export function drawCellPlate(ctx: CanvasRenderingContext2D, size: number, style: CellStyle) {
  const v = style.variant ?? 0;
  ctx.save();
  ctx.scale(size, size);
  const d = pen(ctx);
  d.rect(0, 0, 1, 1, PLATES[v % PLATES.length]!);
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 0.04;
  ctx.strokeRect(0.02, 0.02, 0.96, 0.96);
  for (const [x, y] of [[0.13, 0.13], [0.87, 0.13], [0.13, 0.87], [0.87, 0.87]] as const) d.circle(x, y, 0.035, "#7a756c");
  if (v % 2) d.rect(0.55, 0.55, 0.3, 0.25, "rgba(150,80,40,.35)");
  ctx.restore();
  if (style.damage && style.damage > 0) drawDamage(ctx, size, style.damage, v);
}

/**
 * The working part on top of a plate. May draw outside (0,0)-(size,size), up to ~0.7 cells
 * past the working edge (more for engine flames). `dir` is in the ship frame (0 = up/forward).
 */
export function drawCellPart(ctx: CanvasRenderingContext2D, type: CellType, dir: Dir, size: number, style: CellStyle) {
  ctx.save();
  // rotate so "up" in the part code is the cell's dir, then work in cell units
  ctx.translate(size / 2, size / 2);
  ctx.rotate((dir * Math.PI) / 2);
  ctx.translate(-size / 2, -size / 2);
  ctx.scale(size, size);
  if (style.inactive) ctx.globalAlpha = 0.35;
  PARTS[type]?.(pen(ctx), style, dir);
  ctx.restore();
}

/** Plate + part for a lone cell. Don't use this cell-by-cell for whole ships; see top of file. */
export function drawCell(ctx: CanvasRenderingContext2D, type: CellType, dir: Dir, size: number, style: CellStyle) {
  drawCellPlate(ctx, size, style);
  drawCellPart(ctx, type, dir, size, style);
}

type Pen = ReturnType<typeof pen>;

// tiny drawing vocab in cell units, keeps the part code below readable
function pen(ctx: CanvasRenderingContext2D) {
  return {
    ctx,
    poly(pts: [number, number][], fill: string) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    },
    rect(x: number, y: number, w: number, h: number, fill: string) {
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
    },
    circle(x: number, y: number, r: number, fill: string) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    },
    ellipse(x: number, y: number, rx: number, ry: number, fill: string) {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    },
    line(pts: [number, number][], stroke: string, w: number) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = stroke;
      ctx.lineWidth = w;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    },
    arc(x: number, y: number, r: number, a0: number, a1: number, stroke: string, w: number) {
      ctx.beginPath();
      ctx.arc(x, y, r, a0, a1);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = w;
      ctx.lineCap = "round";
      ctx.stroke();
    },
  };
}

const PI = Math.PI;

const PARTS: Partial<Record<CellType, (d: Pen, s: CellStyle, dir: Dir) => void>> = {
  // teardrop canopy pointing forward + swept tail fins out the back corners, so the core
  // alone says which way the ship faces. Pilot has googly eyes looking forward.
  // Overhangs: tip ~0.2 past the front edge, fins ~0.2 past the back and sides.
  core(d, s) {
    const ctx = d.ctx;
    const fin: [number, number][] = [[0.18, 0.55], [-0.22, 1.15], [0.36, 0.88]];
    d.poly(fin, s.color);
    d.poly(fin.map(([x, y]) => [1 - x, y]), s.color);

    ctx.beginPath();
    ctx.moveTo(0.5, -0.2);
    ctx.bezierCurveTo(0.75, 0.14, 0.88, 0.42, 0.82, 0.67);
    ctx.bezierCurveTo(0.76, 0.92, 0.24, 0.92, 0.18, 0.67);
    ctx.bezierCurveTo(0.12, 0.42, 0.25, 0.14, 0.5, -0.2);
    ctx.closePath();
    ctx.fillStyle = "#16222e";
    ctx.fill();
    ctx.strokeStyle = "rgba(160,200,230,.45)";
    ctx.lineWidth = 0.04;
    ctx.stroke();

    // shoulders, helmet, eyes (pupils nudged forward)
    d.ellipse(0.5, 0.66, 0.25, 0.12, shade(s.color, -0.45));
    d.circle(0.5, 0.5, 0.2, s.color);
    for (const x of [0.41, 0.59]) {
      d.circle(x, 0.43, 0.09, "#fff");
      d.circle(x, 0.38, 0.045, "#111");
    }
    d.arc(0.5, 0.45, 0.27, PI * 1.2, PI * 1.42, "rgba(255,255,255,.35)", 0.03);
  },

  hull() {},

  // pushes "up"; bell + flame hang out the back
  engine(d, s) {
    d.rect(0.2, 0.3, 0.6, 0.55, DARK);
    d.circle(0.5, 0.42, 0.16, "#555b63");
    d.poly([[0.32, 0.8], [0.68, 0.8], [0.9, 1.18], [0.1, 1.15]], METAL_DARK);
    d.poly([[0.38, 0.86], [0.62, 0.86], [0.78, 1.13], [0.22, 1.12]], "#2a2d33");
    d.rect(0.2, 0.62, 0.6, 0.08, TAPE);
    const firing = (s.thrusting ?? true) && !s.inactive;
    if (firing) {
      // flicker a bit when we have a clock
      const len = 0.75 * (s.time === undefined ? 1 : 0.85 + 0.15 * Math.sin(s.time * 40 + (s.variant ?? 0)));
      d.poly([[0.18, 1.17], [0.5, 1.17 + len], [0.82, 1.17]], HOT);
      d.poly([[0.34, 1.17], [0.5, 1.17 + len * 0.55], [0.66, 1.17]], YEL);
    }
  },

  // coil gun: copper rings on a long barrel, glowing tip
  laser(d, s) {
    d.rect(0.25, 0.58, 0.5, 0.32, DARK);
    d.rect(0.42, -0.45, 0.16, 1.08, "#2a2d33");
    for (const y of [0.42, 0.17, -0.08, -0.33]) d.rect(0.32, y, 0.36, 0.08, "#c87a3a");
    d.circle(0.5, -0.47, 0.07, s.inactive ? "#6b6838" : NEON);
  },

  // ripper wheel: hooked teeth sticking out front, spins if given a clock.
  // Hub and reach match the sim's blade hitbox (SIM.sawReach / sawRadius).
  saw(d, s) {
    d.rect(0.3, 0.55, 0.4, 0.38, DARK);
    // arm out to the hub
    const ctx = d.ctx;
    ctx.save();
    // Hub on the cell's edge: the blade sits half on its block.
    ctx.translate(0.5, 0);
    ctx.scale(1.55, 1.55);
    ctx.rotate(s.time === undefined || s.inactive ? 0 : s.time * 12);
    const n = 8;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * PI) / n;
      const b = a + (PI / n) * 1.6;
      pts.push([Math.cos(a) * 0.32, Math.sin(a) * 0.32], [Math.cos(b) * 0.52, Math.sin(b) * 0.52]);
    }
    d.poly(pts, METAL);
    d.circle(0, 0, 0.3, "#8d939b");
    for (let i = 0; i < 4; i++) {
      const a = (i * PI) / 2 + 0.4;
      d.circle(Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.05, "#5a6068");
    }
    d.circle(0, 0, 0.07, DARK);
    ctx.restore();
  },

  // anchor, crown pointing forward, rope coiled at the base
  grapple(d) {
    d.arc(0.5, 0.68, 0.18, 0, PI * 2, "#8a6a3c", 0.06);
    d.arc(0.5, 0.68, 0.1, 0, PI * 2, "#8a6a3c", 0.05);
    d.line([[0.5, 0.5], [0.5, -0.3]], METAL_DARK, 0.09);
    d.line([[0.3, 0.2], [0.7, 0.2]], METAL_DARK, 0.07);
    d.arc(0.5, -0.02, 0.36, PI * 1.12, PI * 1.88, METAL_DARK, 0.09);
    d.poly([[0.12, -0.08], [0.22, -0.22], [0.28, -0.06]], METAL_DARK);
    d.poly([[0.88, -0.08], [0.78, -0.22], [0.72, -0.06]], METAL_DARK);
  },

  // shiny silver strips, cut like the mirror's: armor stops physical hits (saws, rams, squeezes)
  armor(d, s, dir) {
    coatStrips(d, s, dir, { base: "#c3cad3", shine: "#ffffff", lip: "#6c737c" });
  },

  // laser-yellow faceted strip: only reflects lasers, so it shares their colour
  // one strip on every exposed side, so a mirror piece is edged all the way round
  mirror(d, s, dir) {
    coatStrips(d, s, dir, { base: s.inactive ? "#6b6838" : NEON, shine: "#fffbd0", lip: "#a89a1a" });
  },
};

/** A coat's faceted strip along every exposed side of the cell (see mirrorSidesOf). */
function coatStrips(d: Pen, s: CellStyle, dir: Dir, colors: { base: string; shine: string; lip: string }) {
  const sides = s.openSides ?? 15;
  for (let side = 0; side < 4; side++) {
    if (!(sides & (1 << side))) continue;
    // The pen is already turned to the cell's dir; turn on to this ship-frame side.
    const ctx = d.ctx;
    ctx.save();
    ctx.translate(0.5, 0.5);
    ctx.rotate((((side - dir + 4) % 4) * PI) / 2);
    ctx.translate(-0.5, -0.5);
    d.rect(0, -0.14, 1, 0.28, colors.base);
    for (let i = 0; i < 3; i++) {
      const o = i * 0.33;
      d.poly([[0.08 + o, 0.14], [0.2 + o, -0.14], [0.27 + o, -0.14], [0.15 + o, 0.14]], colors.shine);
    }
    d.rect(0, 0.1, 1, 0.04, colors.lip);
    ctx.restore();
  }
}

// ---- The cockpit (the flying-key cluster) ----
// One glass dome over 6 cells laid out like the flying keys, nose up:
//   Q W E      rotate left, up, rotate right
//   A S D      left, down, right
// Each key has a backlit glyph that glows while it's held. They're in the ship frame, same as
// the controls, so a rotated ship still shows which way you're pushing.

/** Key bits (KEY_BITS) by cell of the cockpit, relative to its top-left. */
export const COCKPIT_CELLS: readonly { x: number; y: number; key: number }[] = [
  { x: 0, y: 0, key: 16 },
  { x: 1, y: 0, key: 1 },
  { x: 2, y: 0, key: 32 },
  { x: 2, y: 1, key: 2 },
  { x: 1, y: 1, key: 4 },
  { x: 0, y: 1, key: 8 },
];

export interface CockpitStyle {
  /** Player colour: pilot + fins. */
  color: string;
  /** Held keys, as KEY_BITS (up 1, right 2, down 4, left 8, rotate left 16, rotate right 32). */
  held?: number;
  /**
   * Keys that would do anything with the engines there are (same bits; omit for all). The others
   * are greyed out, and pressing one shows a red X instead of the glow.
   */
  available?: number;
  /** Draw the red X on every dead key, held or not (the draft board, to flag missing engines). */
  markMissing?: boolean;
}

// glyph centres in cockpit units; the down arrow is smaller since the pilot crowds that cell
const COCKPIT_KEYS: readonly { x: number; y: number; key: number; dir?: Dir; spin?: 1 | -1; k: number }[] = [
  { x: 0.55, y: 0.55, key: 16, spin: -1, k: 1 },
  { x: 1.5, y: 0.42, key: 1, dir: 0, k: 1 },
  { x: 2.45, y: 0.55, key: 32, spin: 1, k: 1 },
  { x: 2.58, y: 1.5, key: 2, dir: 1, k: 1 },
  { x: 1.5, y: 1.7, key: 4, dir: 2, k: 0.8 },
  { x: 0.42, y: 1.5, key: 8, dir: 3, k: 1 },
];

/**
 * The whole cockpit, filling (0,0)-(3*size, 2*size) of the current transform (nose up),
 * plus fins hanging ~0.35 cells off the back corners. Draw it in the parts pass, after plates.
 */
export function drawCockpit(ctx: CanvasRenderingContext2D, size: number, style: CockpitStyle) {
  const held = style.held ?? 0;
  ctx.save();
  ctx.scale(size, size);
  const d = pen(ctx);

  // swept fins off the back corners
  const fin: [number, number][] = [[0.1, 1.75], [-0.25, 2.25], [0.4, 1.92]];
  d.poly(fin, style.color);
  d.poly(fin.map(([x, y]) => [3 - x, y]), style.color);

  // dark dome, inset a bit from the cells, rounder at the nose
  const i = 0.08;
  ctx.beginPath();
  ctx.roundRect(i, i, 3 - 2 * i, 2 - 2 * i, [0.5, 0.5, 0.18, 0.18]);
  ctx.fillStyle = "#0c1218";
  ctx.fill();
  ctx.strokeStyle = "rgba(160,200,230,.45)";
  ctx.lineWidth = 0.04;
  ctx.stroke();

  const available = style.available ?? 63;
  for (const g of COCKPIT_KEYS) {
    const on = held & g.key;
    const works = available & g.key;
    // halo spills past the dome on purpose, so held keys read at arena zoom
    if (on && works) [0.5, 0.4, 0.3].forEach((r, j) => d.circle(g.x, g.y, r * g.k, `rgba(120,190,240,${0.12 + j * 0.08})`));
    const fill = !works ? "#262c33" : on ? "#fff" : "#3d6a8a";
    ctx.save();
    ctx.translate(g.x, g.y);
    if (g.dir !== undefined) {
      ctx.rotate((g.dir * PI) / 2);
      const s = 0.24 * g.k;
      d.poly([[0, -s], [s * 0.95, s * 0.5], [-s * 0.95, s * 0.5]], fill);
    } else {
      // a turning arrow: most of a ring, clockwise, its head at the end (mirrored for anticlockwise)
      const r = 0.17 * g.k;
      const a0 = PI * 0.75;
      const a1 = PI * 2.1;
      ctx.scale(g.spin!, 1);
      ctx.beginPath();
      ctx.arc(0, 0, r, a0, a1);
      ctx.strokeStyle = fill;
      ctx.lineWidth = 0.075;
      ctx.lineCap = "round";
      ctx.stroke();
      const ex = r * Math.cos(a1);
      const ey = r * Math.sin(a1);
      const tx = -Math.sin(a1);
      const ty = Math.cos(a1);
      const h = 0.1;
      d.poly([[ex + tx * h, ey + ty * h], [ex + ty * h * 0.9, ey - tx * h * 0.9], [ex - ty * h * 0.9, ey + tx * h * 0.9]], fill);
    }
    ctx.restore();
    // Pressing a key with nothing behind it: a red X over the dead glyph.
    if (!works && (on || style.markMissing)) {
      const x = 0.2 * g.k;
      d.line([[g.x - x, g.y - x], [g.x + x, g.y + x]], "#ff4a3d", 0.08);
      d.line([[g.x + x, g.y - x], [g.x - x, g.y + x]], "#ff4a3d", 0.08);
    }
  }

  // pilot at the middle: shoulders, helmet, googly eyes looking forward
  const px = 1.5;
  const py = 1.1;
  d.ellipse(px, py + 0.16, 0.25, 0.12, shade(style.color, -0.45));
  d.circle(px, py, 0.2, style.color);
  for (const o of [-0.09, 0.09]) {
    d.circle(px + o, py - 0.07, 0.09, "#fff");
    d.circle(px + o, py - 0.12, 0.045, "#111");
  }
  ctx.restore();
}

const ROCK = ["#4a4540", "#443f3a", "#4d4842", "#403c38"];

/**
 * One cell of an asteroid, filling (0,0)-(size,size): rough stone that merges with its rock
 * neighbours, with a dark rim only on the sides open to space (`open`: up, right, down, left).
 */
export function drawRockCell(ctx: CanvasRenderingContext2D, size: number, variant: number, open: readonly boolean[]) {
  const v = Math.abs(variant);
  ctx.save();
  ctx.scale(size, size);
  const d = pen(ctx);
  const [up, right, down, left] = open;
  // Outer corners (both sides open) are rounded off so the rock reads as stone, not plating.
  // The dark rim is the outline; the stone is the same shape pulled in from the open sides.
  const lip = 0.12;
  const shape = (inset: number, fill: string) => {
    const x0 = left ? inset : -0.02;
    const y0 = up ? inset : -0.02;
    const x1 = right ? 1 - inset : 1.02;
    const y1 = down ? 1 - inset : 1.02;
    const r = 0.5 - inset;
    ctx.beginPath();
    ctx.roundRect(x0, y0, x1 - x0, y1 - y0, [up && left ? r : 0, up && right ? r : 0, down && right ? r : 0, down && left ? r : 0]);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  if (up || right || down || left) shape(0, "#25221f");
  shape(lip, ROCK[v % ROCK.length]!);
  if (v % 3 === 0) d.circle(0.3 + ((v >>> 2) % 5) * 0.1, 0.35 + ((v >>> 4) % 4) * 0.1, 0.14, "#36322e");
  if (v % 5 === 1) d.circle(0.65, 0.6, 0.09, "#38342f");
  d.circle(0.2 + ((v >>> 3) % 6) * 0.12, 0.75, 0.05, "#5a544c");
  ctx.restore();
}

/**
 * A free-floating saw blade (tutorial hazard), centred on (0,0) with radius r px: a big toothed
 * disc with a warning glow, spun by `angle`.
 */
export function drawHazardSaw(ctx: CanvasRenderingContext2D, r: number, angle: number) {
  ctx.save();
  const glow = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.5);
  glow.addColorStop(0, "rgba(224, 80, 58, 0.35)");
  glow.addColorStop(1, "rgba(224, 80, 58, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.5, 0, PI * 2);
  ctx.fill();
  ctx.rotate(angle);
  ctx.scale(r, r);
  const d = pen(ctx);
  const n = 10;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * PI) / n;
    const b = a + (PI / n) * 1.6;
    pts.push([Math.cos(a) * 0.68, Math.sin(a) * 0.68], [Math.cos(b) * 1, Math.sin(b) * 1]);
  }
  d.poly(pts, METAL);
  d.circle(0, 0, 0.62, "#8d939b");
  d.arc(0, 0, 0.48, 0, PI * 2, "#e0503a", 0.08);
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * PI) / 5;
    d.circle(Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.07, "#5a6068");
  }
  d.circle(0, 0, 0.13, DARK);
  ctx.restore();
}

/** Darken (amount < 0) or lighten a #rrggbb colour. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (sh: number) => {
    const v = (n >> sh) & 255;
    return Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount);
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function drawDamage(ctx: CanvasRenderingContext2D, s: number, damage: number, v: number) {
  ctx.save();
  ctx.fillStyle = `rgba(10,8,6,${0.1 + damage * 0.4})`;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = `rgba(0,0,0,${0.3 + damage * 0.5})`;
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.beginPath();
  const a = ((v * 53) % 10) / 10;
  ctx.moveTo(s * (0.2 + a * 0.3), 0);
  ctx.lineTo(s * 0.5, s * 0.45);
  ctx.lineTo(s * (0.8 - a * 0.2), s);
  if (damage > 0.5) {
    ctx.moveTo(0, s * 0.6);
    ctx.lineTo(s * 0.5, s * 0.45);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Where to draw a full cockpit for these cells: its top-left in grid units, or null if the six
 * cells aren't all there (test ships with a lone core keep the old canopy).
 */
export function cockpitOrigin(cells: readonly { x: number; y: number; type: CellType; dir: Dir }[]): { x: number; y: number } | null {
  const cores = cells.filter((c) => c.type === "core");
  if (cores.length !== COCKPIT_CELLS.length) return null;
  // The bottom-middle cell is the one pushing down; the others sit round it.
  const s = cores.find((c) => c.dir === 2);
  if (!s) return null;
  const at = new Set(cores.map((c) => `${c.x - s.x + 1},${c.y - s.y + 1}`));
  if (!COCKPIT_CELLS.every((k) => at.has(`${k.x},${k.y}`))) return null;
  return { x: s.x - 1, y: s.y - 1 };
}
