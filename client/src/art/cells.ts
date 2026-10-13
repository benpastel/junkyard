// Programmer art for ship cells. Used by both the draft screen and the arena,
// so a ship looks the same in both. Real junkyard sprites replace this later.
import type { CellType, Dir } from "@ja/shared";

export interface CellStyle {
  /** Player colour, used for trim. */
  color: string;
  /** 0 = pristine, 1 = about to fall off. */
  damage?: number;
  /** Stable per-cell number so plating varies between cells. */
  variant?: number;
  /** Covered by the ship's own hull, so the part does nothing: drawn dimmed and unlit. */
  inactive?: boolean;
}

const PLATE: Record<CellType, string> = {
  core: "#3b3530",
  hull: "#4a4c4f",
  engine: "#3e4146",
  laser: "#3a3a33",
  grapple: "#45474b",
  ram: "#45474b",
  mirror: "#3a3a33",
  armor: "#45474b",
};

// Material families: physical parts (ram, grapple, armor) share bare silver metal;
// energy parts (laser, mirror) share neon yellow.
export const METAL = "#c9ced4";
export const METAL_DARK = "#7d838b";
export const NEON = "#f2ea3c";

/**
 * Draws one cell filling the square (0,0)-(size,size) of `ctx`'s current transform.
 * `dir` is in the ship frame (0 = up/forward).
 */
export function drawCell(ctx: CanvasRenderingContext2D, type: CellType, dir: Dir, size: number, style: CellStyle) {
  const s = size;
  const v = style.variant ?? 0;
  ctx.save();

  // Base plate with a slightly varied tone so the hull looks pieced together.
  const shade = ((v * 37) % 17) - 8;
  ctx.fillStyle = shiftColor(PLATE[type], shade);
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeRect(0.5, 0.5, s - 1, s - 1);

  // Rivets.
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  const r = s * 0.045;
  for (const [px, py] of [
    [0.14, 0.14],
    [0.86, 0.14],
    [0.14, 0.86],
    [0.86, 0.86],
  ] as const) {
    ctx.beginPath();
    ctx.arc(px * s, py * s, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rotate so "up" in the drawing code below is the cell's dir.
  ctx.translate(s / 2, s / 2);
  ctx.rotate((dir * Math.PI) / 2);
  ctx.translate(-s / 2, -s / 2);
  drawFeature(ctx, type, s, style.color, !!style.inactive);
  ctx.restore();
  if (style.inactive) {
    ctx.fillStyle = "rgba(8,9,11,0.55)";
    ctx.fillRect(0, 0, s, s);
  }

  if (style.damage && style.damage > 0) drawDamage(ctx, s, style.damage, v);
}

function drawFeature(ctx: CanvasRenderingContext2D, type: CellType, s: number, color: string, unlit: boolean) {
  switch (type) {
    case "core": {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.arc(s / 2, s * 0.42, s * 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "hull": {
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = s * 0.04;
      ctx.beginPath();
      ctx.moveTo(s * 0.25, s * 0.5);
      ctx.lineTo(s * 0.75, s * 0.5);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(s * 0.1, s * 0.1, s * 0.8, s * 0.08);
      ctx.globalAlpha = 1;
      break;
    }
    case "engine": {
      // Pushes toward "up", so the nozzle opens toward the bottom.
      ctx.fillStyle = "#23262a";
      ctx.beginPath();
      ctx.moveTo(s * 0.3, s * 0.3);
      ctx.lineTo(s * 0.7, s * 0.3);
      ctx.lineTo(s * 0.86, s);
      ctx.lineTo(s * 0.14, s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(s * 0.28, s * 0.18, s * 0.44, s * 0.14);
      ctx.fillStyle = "#e8a04a";
      ctx.globalAlpha = 0.5;
      ctx.fillRect(s * 0.24, s * 0.86, s * 0.52, s * 0.08);
      ctx.globalAlpha = 1;
      break;
    }
    case "laser": {
      ctx.fillStyle = "#1e1f22";
      ctx.fillRect(s * 0.4, 0, s * 0.2, s * 0.6);
      ctx.fillStyle = color;
      ctx.fillRect(s * 0.28, s * 0.6, s * 0.44, s * 0.22);
      neon(ctx, s, unlit, () => {
        ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.07);
        ctx.fillRect(s * 0.42, s * 0.02, s * 0.16, s * 0.12);
      });
      break;
    }
    case "mirror": {
      // Reflective edge along the top.
      ctx.fillStyle = color;
      ctx.fillRect(s * 0.38, s * 0.55, s * 0.24, s * 0.24);
      ctx.fillStyle = "#1e1f22";
      ctx.fillRect(s * 0.08, s * 0.16, s * 0.84, s * 0.1);
      neon(ctx, s, unlit, () => ctx.fillRect(0, 0, s, s * 0.16));
      break;
    }
    case "armor": {
      // Thick plate along the top.
      metalRect(ctx, 0, 0, s, s * 0.26);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      for (const px of [0.2, 0.5, 0.8]) {
        ctx.beginPath();
        ctx.arc(px * s, s * 0.13, s * 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.fillRect(s * 0.38, s * 0.55, s * 0.24, s * 0.24);
      break;
    }
    case "grapple": {
      ctx.strokeStyle = METAL_DARK;
      ctx.lineWidth = s * 0.1;
      ctx.beginPath();
      ctx.moveTo(s / 2, s * 0.85);
      ctx.lineTo(s / 2, s * 0.2);
      ctx.stroke();
      ctx.strokeStyle = METAL;
      ctx.lineWidth = s * 0.09;
      ctx.beginPath();
      ctx.moveTo(s * 0.25, s * 0.38);
      ctx.lineTo(s / 2, s * 0.1);
      ctx.lineTo(s * 0.75, s * 0.38);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(s * 0.36, s * 0.7, s * 0.28, s * 0.14);
      break;
    }
    case "ram": {
      const g = ctx.createLinearGradient(s * 0.1, 0, s * 0.9, 0);
      g.addColorStop(0, METAL_DARK);
      g.addColorStop(0.45, METAL);
      g.addColorStop(1, METAL_DARK);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(s * 0.1, s * 0.75);
      ctx.lineTo(s / 2, -s * 0.05);
      ctx.lineTo(s * 0.9, s * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(s * 0.1, s * 0.75, s * 0.8, s * 0.12);
      break;
    }
  }
}

function neon(ctx: CanvasRenderingContext2D, s: number, unlit: boolean, paint: () => void) {
  ctx.save();
  if (unlit) {
    ctx.fillStyle = "#6b6838";
    paint();
    ctx.restore();
    return;
  }
  ctx.fillStyle = NEON;
  ctx.shadowColor = NEON;
  ctx.shadowBlur = Math.max(2, s * 0.35);
  paint();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,210,0.28)";
  paint();
  ctx.restore();
}

function metalRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, "#eef1f4");
  g.addColorStop(0.4, METAL);
  g.addColorStop(1, METAL_DARK);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

function drawDamage(ctx: CanvasRenderingContext2D, s: number, damage: number, v: number) {
  ctx.save();
  ctx.fillStyle = `rgba(20,10,5,${0.15 + damage * 0.45})`;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = `rgba(0,0,0,${0.4 + damage * 0.5})`;
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

function shiftColor(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (sh: number) => Math.max(0, Math.min(255, ((n >> sh) & 255) + amount));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
