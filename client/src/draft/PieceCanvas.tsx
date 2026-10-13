import { memo, useLayoutEffect, useRef } from "react";
import type { Cell } from "@ja/shared";
import { drawCell } from "../art/cells";

/** Stable per-position variant so plating doesn't reshuffle between redraws. */
export function cellVariant(x: number, y: number): number {
  return (Math.imul(x + 31, 73856093) ^ Math.imul(y + 17, 19349663)) >>> 0;
}

/** Draws a set of cells (min x/y = 0) at `cell` CSS pixels per square. */
export const PieceCanvas = memo(function PieceCanvas(props: {
  cells: readonly Cell[];
  cell: number;
  color: string;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { cells, cell, color } = props;

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = Math.max(...cells.map((c) => c.x)) + 1;
    const h = Math.max(...cells.map((c) => c.y)) + 1;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * cell * dpr);
    canvas.height = Math.round(h * cell * dpr);
    canvas.style.width = `${w * cell}px`;
    canvas.style.height = `${h * cell}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w * cell, h * cell);
    for (const c of cells) {
      ctx.save();
      ctx.translate(c.x * cell, c.y * cell);
      drawCell(ctx, c.type, c.dir, cell, { color, variant: cellVariant(c.x, c.y) });
      ctx.restore();
    }
  }, [cells, cell, color]);

  return <canvas ref={ref} className={props.className} />;
});
