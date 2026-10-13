import { memo, useLayoutEffect, useRef } from "react";
import type { Cell } from "@ja/shared";

/** Thumbnails fit in this many pixels whatever the hull size. */
const BOX = 70;

/** A small live thumbnail of a rival's ship: hull outline plus parts in their colour. */
export const RivalShip = memo(function RivalShip(props: { hullRows: string[]; cells: Cell[]; color: string; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { hullRows, cells, color } = props;

  useLayoutEffect(() => {
    const canvas = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const CELL = Math.max(3, Math.floor(BOX / Math.max(hullRows[0]!.length, hullRows.length)));
    const W = hullRows[0]!.length * CELL;
    const H = hullRows.length * CELL;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    hullRows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === ".") return;
        ctx.fillStyle = "#1a1e25";
        ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
      }),
    );
    for (const c of cells) {
      ctx.fillStyle = c.type === "hull" ? "#4a4c4f" : c.type === "core" ? "#ffffff" : color;
      ctx.fillRect(c.x * CELL, c.y * CELL, CELL - 1, CELL - 1);
    }
  }, [hullRows, cells, color]);

  return (
    <figure className="rival">
      <canvas ref={ref} />
      <figcaption style={{ color }}>{props.name}</figcaption>
    </figure>
  );
});
