// Programmer art for ship cells. Used by both the draft screen and the arena,
// so a ship looks the same in both. Plates are deliberately plain so the working
// parts (and which way they point) read at a glance.
import type { CellType, Dir } from "@ja/shared";

export interface CellStyle {
  /** Player colour, used for the core. */
  color: string;
  /** 0 = pristine, 1 = about to fall off. */
  damage?: number;
  /** Stable per-cell number, used to vary damage cracks. */
  variant?: number;
  /** Covered by the ship's own hull, so the part does nothing: drawn dimmed and unlit. */
  inactive?: boolean;
}

const PLATE = "#3b3f46";
const PLATE_EDGE = "#24272c";

// Material families: physical parts (ram, grapple, armor) share bare silver metal;
// energy parts (laser, mirror) share neon yellow. Engines are hot orange.
export const METAL = "#c9ced4";
export const METAL_DARK = "#7d838b";
export const NEON = "#f2ea3c";
export const HOT = "#ff8a2a";

/**
 * Draws one cell filling the square (0,0)-(size,size) of `ctx`'s current transform.
 * `dir` is in the ship frame (0 = up/forward).
 */
export function drawCell(ctx: CanvasRenderingContext2D, type: CellType, dir: Dir, size: number, style: CellStyle) {
  const s = size;
  ctx.save();

  ctx.fillStyle = PLATE;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = PLATE_EDGE;
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.strokeRect(0.5, 0.5, s - 1, s - 1);

  // Rotate so "up" in the drawing code below is the cell's dir.
  ctx.translate(s / 2, s / 2);
  ctx.rotate((dir * Math.PI) / 2);
  ctx.translate(-s / 2, -s / 2);
  drawFeature(ctx, type, s, style.color, !!style.inactive);
  ctx.restore();

  // Covered shield edges just go unlit (drawn above); other covered parts are dimmed whole.
  if (style.inactive && type !== "mirror" && type !== "armor") {
    ctx.fillStyle = "rgba(8,9,11,0.6)";
    ctx.fillRect(0, 0, s, s);
  }
  if (style.damage && style.damage > 0) drawDamage(ctx, s, style.damage, style.variant ?? 0);
}

function drawFeature(ctx: CanvasRenderingContext2D, type: CellType, s: number, color: string, unlit: boolean) {
  switch (type) {
    case "core": {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(s / 2, s * 0.42, s * 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "hull":
      break;
    case "engine": {
      // Pushes toward "up": a bold arrow pointing up, with the nozzle flaring out of the bottom edge.
      ctx.fillStyle = "#1c1e22";
      ctx.beginPath();
      ctx.moveTo(s * 0.3, s * 0.62);
      ctx.lineTo(s * 0.7, s * 0.62);
      ctx.lineTo(s * 0.88, s);
      ctx.lineTo(s * 0.12, s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = unlit ? "#6b4a30" : HOT;
      ctx.fillRect(s * 0.18, s * 0.9, s * 0.64, s * 0.1);
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.08);
      ctx.lineTo(s * 0.82, s * 0.48);
      ctx.lineTo(s * 0.62, s * 0.48);
      ctx.lineTo(s * 0.62, s * 0.58);
      ctx.lineTo(s * 0.38, s * 0.58);
      ctx.lineTo(s * 0.38, s * 0.48);
      ctx.lineTo(s * 0.18, s * 0.48);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "laser": {
      // A barrel running from a base block out through the top edge.
      ctx.fillStyle = "#1c1e22";
      ctx.fillRect(s * 0.26, s * 0.56, s * 0.48, s * 0.34);
      neon(ctx, s, unlit, () => {
        ctx.fillRect(s * 0.4, 0, s * 0.2, s * 0.62);
        ctx.fillRect(s * 0.32, 0, s * 0.36, s * 0.1);
      });
      break;
    }
    case "mirror": {
      // Reflective edge along the top.
      neon(ctx, s, unlit, () => ctx.fillRect(0, 0, s, s * 0.18));
      break;
    }
    case "armor": {
      // Thick plate along the top.
      if (unlit) {
        ctx.fillStyle = "#5a5e64";
        ctx.fillRect(0, 0, s, s * 0.26);
      } else metalRect(ctx, 0, 0, s, s * 0.26);
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
      ctx.lineWidth = s * 0.1;
      ctx.beginPath();
      ctx.moveTo(s * 0.22, s * 0.4);
      ctx.lineTo(s / 2, s * 0.1);
      ctx.lineTo(s * 0.78, s * 0.4);
      ctx.stroke();
      break;
    }
    case "ram": {
      const g = ctx.createLinearGradient(s * 0.1, 0, s * 0.9, 0);
      g.addColorStop(0, METAL_DARK);
      g.addColorStop(0.45, METAL);
      g.addColorStop(1, METAL_DARK);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(s * 0.1, s * 0.85);
      ctx.lineTo(s / 2, 0);
      ctx.lineTo(s * 0.9, s * 0.85);
      ctx.closePath();
      ctx.fill();
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
  ctx.shadowBlur = Math.max(2, s * 0.3);
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
