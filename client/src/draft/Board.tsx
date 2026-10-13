import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { buildableSet, cellKey, placedCells, placementError, transformCells, type Piece } from "@ja/shared/draft";
import { openChecker, type Cell, type Dir } from "@ja/shared";
import { useClock } from "../art/useClock";
import { cellVariant, drawShipCells } from "./PieceCanvas";

export interface DragState {
  /** True while a piece card is being dragged with the pointer held down. */
  active: boolean;
  startX: number;
  startY: number;
  moved: boolean;
}

const FLASH_MS = 320;
const MAX_CELL = 68;
/** Margin around the hull, in cells, so parts overhanging the outer squares aren't clipped. */
const PAD = 1;

/** Top-left anchor that keeps the piece's middle under the pointer. */
export function anchorFor(piece: Piece, rot: Dir, flip: boolean, hover: { x: number; y: number }) {
  const shape = transformCells(piece.cells, rot, flip);
  const w = Math.max(...shape.map((c) => c.x)) + 1;
  const h = Math.max(...shape.map((c) => c.y)) + 1;
  return { x: hover.x - Math.floor(w / 2), y: hover.y - Math.floor(h / 2) };
}

export function Board(props: {
  hullRows: string[];
  cells: Cell[];
  held: Piece | null;
  rot: Dir;
  flip: boolean;
  color: string;
  drag: MutableRefObject<DragState>;
  onHoverChange: (over: boolean) => void;
  onPlace: (x: number, y: number) => void;
}) {
  const { hullRows, cells, held, rot, flip, color, drag, onHoverChange, onPlace } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cell, setCell] = useState(40);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const downOnBoard = useRef(false);
  const flashes = useRef(new Map<string, number>());
  const [, setFrame] = useState(0);

  const cols = hullRows[0]!.length;
  const rows = hullRows.length;
  const buildable = useRef(buildableSet(hullRows));
  useEffect(() => {
    buildable.current = buildableSet(hullRows);
  }, [hullRows]);

  // Fit the grid to the available space.
  useLayoutEffect(() => {
    const wrap = wrapRef.current!;
    const fit = () => {
      const r = wrap.getBoundingClientRect();
      setCell(Math.max(18, Math.min(MAX_CELL, Math.floor(Math.min(r.width / (cols + PAD * 2), r.height / (rows + PAD * 2))))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [cols, rows]);

  // Flash newly placed cells.
  const prevKeys = useRef<Set<string> | null>(null);
  useEffect(() => {
    const keys = new Set(cells.map((c) => cellKey(c.x, c.y)));
    if (prevKeys.current) {
      const now = performance.now();
      for (const k of keys) if (!prevKeys.current.has(k)) flashes.current.set(k, now);
    }
    prevKeys.current = keys;
    if (flashes.current.size === 0) return;
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      for (const [k, t] of flashes.current) if (now - t > FLASH_MS) flashes.current.delete(k);
      setFrame((f) => f + 1);
      if (flashes.current.size > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cells]);

  const ghost = held && hover ? placedCells(held, ...anchorArgs(held, rot, flip, hover)) : null;
  const ghostValid = ghost ? placementError(buildable.current, cells, ghost) === null : false;
  const time = useClock(cells.some((c) => c.type === "saw") || !!ghost?.some((c) => c.type === "saw"));

  // Draw.
  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const W = (cols + PAD * 2) * cell;
    const H = (rows + PAD * 2) * cell;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(PAD * cell, PAD * cell);
    drawBay(ctx, hullRows, cell);

    // Covered parts (including ones whose overhang lands on another piece) are judged against
    // the ship as it would be with the ghost placed, and drawn faded.
    const isOpen = openChecker(ghost && ghostValid ? [...cells, ...ghost] : cells);
    drawShipCells(
      ctx,
      cells,
      cell,
      (c) => ({ color, variant: cellVariant(c.x, c.y), inactive: !isOpen(c), time }),
      (c) => {
        const t = flashes.current.get(cellKey(c.x, c.y));
        if (t === undefined) return;
        const k = 1 - Math.min(1, (performance.now() - t) / FLASH_MS);
        ctx.fillStyle = `rgba(255, 214, 150, ${0.55 * k})`;
        ctx.fillRect(0, 0, cell, cell);
      },
    );

    if (ghost) {
      ctx.save();
      ctx.globalAlpha = ghostValid ? 0.9 : 0.55;
      drawShipCells(
        ctx,
        ghost,
        cell,
        (c) => ({ color, variant: cellVariant(c.x, c.y), inactive: ghostValid && !isOpen(c), time }),
        () => {
          ctx.fillStyle = ghostValid ? "rgba(127, 201, 107, 0.22)" : "rgba(224, 80, 58, 0.38)";
          ctx.fillRect(0, 0, cell, cell);
        },
      );
      ctx.restore();
      // Outline the piece silhouette.
      const inGhost = new Set(ghost.map((c) => cellKey(c.x, c.y)));
      ctx.strokeStyle = ghostValid ? "#7fc96b" : "#e0503a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const c of ghost) {
        const x0 = c.x * cell;
        const y0 = c.y * cell;
        if (!inGhost.has(cellKey(c.x, c.y - 1))) (ctx.moveTo(x0, y0), ctx.lineTo(x0 + cell, y0));
        if (!inGhost.has(cellKey(c.x, c.y + 1))) (ctx.moveTo(x0, y0 + cell), ctx.lineTo(x0 + cell, y0 + cell));
        if (!inGhost.has(cellKey(c.x - 1, c.y))) (ctx.moveTo(x0, y0), ctx.lineTo(x0, y0 + cell));
        if (!inGhost.has(cellKey(c.x + 1, c.y))) (ctx.moveTo(x0 + cell, y0), ctx.lineTo(x0 + cell, y0 + cell));
      }
      ctx.stroke();
    }
  });

  const cellAt = useCallback(
    (clientX: number, clientY: number) => {
      const r = canvasRef.current!.getBoundingClientRect();
      // Half a cell of slack around the grid so edge placements are easy to hit.
      const slack = cell / 2;
      if (clientX < r.left - slack || clientX > r.right + slack || clientY < r.top - slack || clientY > r.bottom + slack) {
        return null;
      }
      return { x: Math.floor((clientX - r.left) / cell) - PAD, y: Math.floor((clientY - r.top) / cell) - PAD };
    },
    [cell, cols, rows],
  );

  // Pointer tracking is on window so drags from the side panels land here too.
  const latest = useRef({ held, rot, flip, cells, cellAt, onPlace });
  latest.current = { held, rot, flip, cells, cellAt, onPlace };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const overWrap = isOver(wrapRef.current!, e);
      const h = overWrap ? latest.current.cellAt(e.clientX, e.clientY) : null;
      setHover((prev) => (prev?.x === h?.x && prev?.y === h?.y ? prev : h));
      onHoverChange(h !== null);
      const d = drag.current;
      if (d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) d.moved = true;
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      const fromDrag = d.active && d.moved;
      const fromBoard = downOnBoard.current;
      d.active = false;
      downOnBoard.current = false;
      if (e.button !== 0 || !(fromDrag || fromBoard)) return;
      const { held, rot, flip, cellAt, onPlace } = latest.current;
      const h = isOver(wrapRef.current!, e) ? cellAt(e.clientX, e.clientY) : null;
      if (!held || !h) return;
      const a = anchorFor(held, rot, flip, h);
      const cells = placedCells(held, a.x, a.y, rot, flip);
      if (placementError(buildable.current, latest.current.cells, cells) === null) onPlace(a.x, a.y);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, onHoverChange]);

  return (
    <div
      ref={wrapRef}
      className="draft-board"
      onPointerDown={(e) => {
        if (e.button === 0) downOnBoard.current = true;
      }}
    >
      <canvas ref={canvasRef} className={held && hover ? "holding" : undefined} />
    </div>
  );
}

function isOver(el: HTMLElement, e: PointerEvent): boolean {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
}

function anchorArgs(piece: Piece, rot: Dir, flip: boolean, hover: { x: number; y: number }): [number, number, Dir, boolean] {
  const a = anchorFor(piece, rot, flip, hover);
  return [a.x, a.y, rot, flip];
}

/** Faint riveted floor plates for the buildable squares, with a rusty rim around the hull. */
function drawBay(ctx: CanvasRenderingContext2D, hullRows: string[], cell: number) {
  const inside = (x: number, y: number) => (hullRows[y]?.[x] ?? ".") !== ".";
  hullRows.forEach((row, y) =>
    [...row].forEach((_, x) => {
      if (!inside(x, y)) return;
      const x0 = x * cell;
      const y0 = y * cell;
      ctx.fillStyle = (x + y) % 2 === 0 ? "#151920" : "#13161c";
      ctx.fillRect(x0, y0, cell, cell);
      ctx.strokeStyle = "rgba(255,255,255,0.045)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, cell - 1, cell - 1);
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      for (const [px, py] of [
        [0.12, 0.12],
        [0.88, 0.12],
        [0.12, 0.88],
        [0.88, 0.88],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x0 + px * cell, y0 + py * cell, Math.max(1, cell * 0.03), 0, Math.PI * 2);
        ctx.fill();
      }
    }),
  );

  ctx.strokeStyle = "#8f4520";
  ctx.lineWidth = 2;
  ctx.beginPath();
  hullRows.forEach((row, y) =>
    [...row].forEach((_, x) => {
      if (!inside(x, y)) return;
      const x0 = x * cell;
      const y0 = y * cell;
      if (!inside(x, y - 1)) (ctx.moveTo(x0, y0 + 1), ctx.lineTo(x0 + cell, y0 + 1));
      if (!inside(x, y + 1)) (ctx.moveTo(x0, y0 + cell - 1), ctx.lineTo(x0 + cell, y0 + cell - 1));
      if (!inside(x - 1, y)) (ctx.moveTo(x0 + 1, y0), ctx.lineTo(x0 + 1, y0 + cell));
      if (!inside(x + 1, y)) (ctx.moveTo(x0 + cell - 1, y0), ctx.lineTo(x0 + cell - 1, y0 + cell));
    }),
  );
  ctx.stroke();
}
