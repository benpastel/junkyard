import { memo, useLayoutEffect, useRef } from "react";
import { openChecker, type Cell } from "@ja/shared";
import { cockpitOrigin, drawCellPart, drawCellPlate, drawCockpit, mirrorSidesOf, type CellStyle } from "../art/cells";
import { useClock } from "../art/useClock";

/** Room around the piece, in cells, for parts that overhang their square. */
export const PIECE_PAD = 0.8;

/** Stable per-position variant so plating doesn't reshuffle between redraws. */
export function cellVariant(x: number, y: number): number {
  return (Math.imul(x + 31, 73856093) ^ Math.imul(y + 17, 19349663)) >>> 0;
}

/**
 * Draws cells at their grid positions in two passes (all plates, then all parts) so parts that
 * overhang their square land on top of the neighbouring plates.
 */
export function drawShipCells(
  ctx: CanvasRenderingContext2D,
  cells: readonly Cell[],
  cell: number,
  style: (c: Cell) => CellStyle,
  overPlate?: (c: Cell) => void,
) {
  const sides = mirrorSidesOf(cells);
  const styled = (c: Cell): CellStyle => ({ ...style(c), openSides: sides(c) });
  for (const c of cells) {
    ctx.save();
    ctx.translate(c.x * cell, c.y * cell);
    drawCellPlate(ctx, cell, styled(c));
    overPlate?.(c);
    ctx.restore();
  }
  // A full cockpit is drawn once over its four cells instead of cell by cell.
  const cockpit = cockpitOrigin(cells);
  for (const c of cells) {
    if (cockpit && c.type === "core") continue;
    ctx.save();
    ctx.translate(c.x * cell, c.y * cell);
    drawCellPart(ctx, c.type, c.dir, cell, styled(c));
    ctx.restore();
  }
  if (cockpit) {
    const core = cells.find((c) => c.type === "core")!;
    // Arrows with no working engine behind them yet are greyed out.
    const isOpen = openChecker(cells);
    let available = 0;
    for (const c of cells) if (c.type === "engine" && isOpen(c)) available |= 1 << c.dir;
    ctx.save();
    ctx.translate(cockpit.x * cell, cockpit.y * cell);
    drawCockpit(ctx, cell, { color: style(core).color, available });
    ctx.restore();
  }
}

/** Draws a set of cells (min x/y = 0) at `cell` CSS pixels per square, with room for overhangs. */
export const PieceCanvas = memo(function PieceCanvas(props: {
  cells: readonly Cell[];
  cell: number;
  color: string;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { cells, cell, color } = props;
  const time = useClock(cells.some((c) => c.type === "saw"));

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = Math.max(...cells.map((c) => c.x)) + 1 + PIECE_PAD * 2;
    const h = Math.max(...cells.map((c) => c.y)) + 1 + PIECE_PAD * 2;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * cell * dpr);
    canvas.height = Math.round(h * cell * dpr);
    canvas.style.width = `${w * cell}px`;
    canvas.style.height = `${h * cell}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w * cell, h * cell);
    ctx.translate(PIECE_PAD * cell, PIECE_PAD * cell);
    drawShipCells(ctx, cells, cell, (c) => ({ color, variant: cellVariant(c.x, c.y), time }));
  }, [cells, cell, color, time]);

  return <canvas ref={ref} className={props.className} />;
});
