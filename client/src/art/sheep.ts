// A sheep in a spacesuit, for the tutorial's sheep-collecting level.
// Style follows cells.ts: flat fills, a few highlights, chunky silhouette that still reads at
// r≈10px: white puffy cloud + dark face + glass bubble. Front-facing, so it reads at any spin.

const WOOL = ["#f3efe6", "#eef0ec", "#f2ece8", "#f5f1e2"];
const WOOL_SHADE = "#a9a59d";
const FACE = "#3a3a41";
const FACE_LIGHT = "#4e4e57";
const EAR_IN = "#c99a9a";
const LEG = "#55555f";
const HOOF = "#2a2a30";
const EYE = "#ffffff";
const PUPIL = "#16161a";
// suit accents: muted so they never read as a player colour
const ACCENTS = ["#9fb4b8", "#b6adc2", "#d9d2c3", "#a9b3c1", "#b9b6a8"];

// [x, y, radius] in sheep units (before the fit scale below)
const PUFFS: readonly (readonly [number, number, number])[] = [
  [-0.48, 0.2, 0.22],
  [-0.42, 0.45, 0.2],
  [-0.2, 0.58, 0.2],
  [0.06, 0.6, 0.2],
  [0.3, 0.55, 0.2],
  [0.48, 0.36, 0.2],
  [0.48, 0.1, 0.19],
  [-0.44, -0.04, 0.17],
  [0.42, -0.08, 0.17],
  [0, 0.32, 0.38],
];
const LEGS = [-0.34, -0.12, 0.12, 0.34];
// the drawing spans about radius 1.0 in sheep units; leave room for bob and tilt
const FIT = 0.85;
const TAU = Math.PI * 2;

/**
 * A sheep in a spacesuit, centred on (0,0), fitting inside a circle of radius r (CSS px in the
 * current transform). `t` is seconds (for idle animation), `variant` a stable per-sheep number.
 */
export function drawSheep(ctx: CanvasRenderingContext2D, r: number, opts: { t: number; variant: number }) {
  const v = Math.abs(Math.floor(opts.variant));
  const t = opts.t;
  const ph = v * 1.737;
  const wool = WOOL[v % WOOL.length]!;
  const accent = ACCENTS[(v * 3 + 1) % ACCENTS.length]!;
  // lines below this width (px) vanish at play size, so widen them when r is small
  const px = 1 / (r * FIT);

  ctx.save();
  ctx.scale(r * FIT, r * FIT);

  // faint halo so the sheep pops off near-black space
  ctx.translate(0, Math.sin(t * 1.6 + ph) * 0.04);
  ctx.rotate(Math.sin(t * 1.05 + ph * 1.3) * 0.09);
  ctx.lineCap = "round";

  // legs, paddling slowly in zero-g (behind the fleece, hooves poking out below)
  ctx.strokeStyle = LEG;
  ctx.lineWidth = Math.max(0.15, 2.2 * px);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const x = LEGS[i]!;
    const swing = Math.sin(t * 2.6 + ph + i * 1.9) * 0.1;
    ctx.moveTo(x, 0.6);
    ctx.lineTo(x * 1.1 + swing, 0.97 - Math.abs(swing) * 0.3);
  }
  ctx.stroke();
  if (r >= 20) {
    ctx.strokeStyle = HOOF;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const x = LEGS[i]!;
      const swing = Math.sin(t * 2.6 + ph + i * 1.9) * 0.1;
      const fx = x * 1.1 + swing;
      const fy = 0.97 - Math.abs(swing) * 0.3;
      ctx.moveTo(fx - swing * 0.25, fy - 0.06);
      ctx.lineTo(fx, fy);
    }
    ctx.stroke();
  }

  // wool: faint light rim so it pops off space, shade pass offset down-right, then the fleece
  ctx.beginPath();
  for (const [x, y, pr] of PUFFS) {
    ctx.moveTo(x + 0.02 + pr + 0.09, y + 0.02);
    ctx.arc(x + 0.02, y + 0.02, pr + 0.09, 0, TAU);
  }
  ctx.fillStyle = "rgba(210,225,240,0.13)";
  ctx.fill();
  ctx.beginPath();
  for (const [x, y, pr] of PUFFS) {
    ctx.moveTo(x + 0.04 + pr + 0.03, y + 0.05);
    ctx.arc(x + 0.04, y + 0.05, pr + 0.03, 0, TAU);
  }
  ctx.fillStyle = WOOL_SHADE;
  ctx.fill();
  ctx.beginPath();
  for (const [x, y, pr] of PUFFS) {
    ctx.moveTo(x + pr, y);
    ctx.arc(x, y, pr, 0, TAU);
  }
  ctx.fillStyle = wool;
  ctx.fill();

  // suit collar where the helmet seals onto the fleece
  ctx.beginPath();
  ctx.ellipse(0, 0.15, 0.38, 0.1, 0, 0, Math.PI);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(0.1, 2 * px);
  ctx.stroke();

  // inside the helmet: ears, face, top tuft, eyes
  const hy = -0.28;
  const hr = 0.5;
  const fy = -0.2; // face centre
  const ey = fy - 0.05; // eye line
  ctx.fillStyle = FACE;
  ctx.beginPath();
  ctx.ellipse(-0.3, fy - 0.12, 0.15, 0.075, -0.4, 0, TAU);
  ctx.moveTo(0.45, fy - 0.12);
  ctx.ellipse(0.3, fy - 0.12, 0.15, 0.075, 0.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = EAR_IN;
  ctx.beginPath();
  ctx.ellipse(-0.32, fy - 0.115, 0.08, 0.035, -0.4, 0, TAU);
  ctx.moveTo(0.4, fy - 0.115);
  ctx.ellipse(0.32, fy - 0.115, 0.08, 0.035, 0.4, 0, TAU);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(0, fy, 0.25, 0.3, 0, 0, TAU);
  ctx.fillStyle = FACE;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, fy + 0.17, 0.14, 0.085, 0, 0, TAU);
  ctx.fillStyle = FACE_LIGHT;
  ctx.fill();

  ctx.beginPath();
  for (const [x, y, pr] of [[-0.12, fy - 0.26, 0.1], [0.12, fy - 0.26, 0.1], [0, fy - 0.31, 0.11]] as const) {
    ctx.moveTo(x + pr, y);
    ctx.arc(x, y, pr, 0, TAU);
  }
  ctx.fillStyle = wool;
  ctx.fill();

  const blink = (t + ph) % 4.7 < 0.13;
  const look = Math.sin(t * 0.5 + ph) * 0.025;
  if (blink) {
    ctx.beginPath();
    ctx.moveTo(-0.17, ey);
    ctx.lineTo(-0.05, ey);
    ctx.moveTo(0.05, ey);
    ctx.lineTo(0.17, ey);
    ctx.strokeStyle = EYE;
    ctx.lineWidth = Math.max(0.04, 1.2 * px);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(-0.105, ey, 0.09, 0.105, 0, 0, TAU);
    ctx.moveTo(0.195, ey);
    ctx.ellipse(0.105, ey, 0.09, 0.105, 0, 0, TAU);
    ctx.fillStyle = EYE;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-0.1 + look, ey + 0.02, 0.058, 0, TAU);
    ctx.moveTo(0.11 + look + 0.058, ey + 0.02);
    ctx.arc(0.11 + look, ey + 0.02, 0.058, 0, TAU);
    ctx.fillStyle = PUPIL;
    ctx.fill();
    if (r >= 14) {
      ctx.beginPath();
      ctx.arc(-0.08 + look, ey - 0.01, 0.022, 0, TAU);
      ctx.moveTo(0.13 + look + 0.022, ey - 0.01);
      ctx.arc(0.13 + look, ey - 0.01, 0.022, 0, TAU);
      ctx.fillStyle = EYE;
      ctx.fill();
    }
  }
  if (r >= 20) {
    // little smile
    ctx.beginPath();
    ctx.arc(0, fy + 0.13, 0.06, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.strokeStyle = "#22222a";
    ctx.lineWidth = Math.max(0.025, 1 * px);
    ctx.stroke();
  }

  // antenna with a blinking tip
  const ax = 0.2;
  const ay = hy - Math.sqrt(hr * hr - ax * ax);
  const tipX = 0.3;
  const tipY = -0.93;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(0.035, 1.1 * px);
  ctx.stroke();
  const on = Math.sin(t * 3.1 + ph * 2) > 0.2;
  if (on) {
    ctx.beginPath();
    ctx.arc(tipX, tipY, 0.11, 0, TAU);
    ctx.fillStyle = "rgba(225,255,215,0.22)";
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(tipX, tipY, Math.max(0.06, 1.3 * px), 0, TAU);
  ctx.fillStyle = on ? "#eaffdc" : "#6f7c6c";
  ctx.fill();

  // glass bubble: tint, rim, glints
  ctx.beginPath();
  ctx.arc(0, hy, hr, 0, TAU);
  ctx.fillStyle = "rgba(170,210,235,0.16)";
  ctx.fill();
  ctx.strokeStyle = "rgba(215,235,248,0.6)";
  ctx.lineWidth = Math.max(0.04, 1.1 * px);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, hy, hr - 0.08, 1.1 * Math.PI, 1.42 * Math.PI);
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = Math.max(0.06, 1.4 * px);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0.27, -0.56, Math.max(0.03, 0.9 * px), 0, TAU);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fill();

  ctx.restore();
}
