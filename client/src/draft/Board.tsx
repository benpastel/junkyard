import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { buildableSet, cellKey, deadSquares, placedCells, placementError, type Piece } from "@ja/shared/draft";
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

/**
 * Whether a touch currently drives the held piece: only a touch that began on an offer or on the
 * board does. Taps elsewhere (the rotate buttons) must not drag the piece over to the finger.
 */
export const touchTrack = { on: false };
/** Margin around the hull, in cells, so parts overhanging the outer squares aren't clipped. */
export const BOARD_PAD = 1;
const PAD = BOARD_PAD;

export function Board(props: {
  hullRows: string[];
  cells: Cell[];
  held: Piece | null;
  rot: Dir;
  flip: boolean;
  /** Where the pointer holds the piece, in cells from its top-left corner. */
  grab: { x: number; y: number };
  /** CSS pixels per square, shared with the offers so a piece keeps its size. */
  cell: number;
  color: string;
  drag: MutableRefObject<DragState>;
  onHoverChange: (over: boolean) => void;
  onPlace: (x: number, y: number) => void;
}) {
  const { hullRows, cells, held, rot, flip, grab, cell, color, drag, onHoverChange, onPlace } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The grid square the held piece's top-left would land on.
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

  const ghost = held && hover ? placedCells(held, hover.x, hover.y, rot, flip) : null;
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
    drawBay(ctx, hullRows, cell, deadSquares(buildable.current, cells));

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
      // Missing engine directions get a red X; a valid piece under the pointer that would add
      // one clears its X and lights that arrow up.
      { engineCells: ghost && ghostValid ? [...cells, ...ghost] : cells, markMissing: true },
    );

    if (ghost) {
      ctx.save();
      ctx.globalAlpha = ghostValid ? 0.9 : 0.55;
      drawShipCells(
        ctx,
        ghost,
        cell,
        (c) => ({ color, variant: cellVariant(c.x, c.y), inactive: ghostValid && !isOpen(c), time }),
        (c) => {
          // Squares hanging off the hull get a solid red wash so they read as outside.
          ctx.fillStyle = !insideHull(hullRows, c.x, c.y)
            ? "rgba(150, 30, 20, 0.75)"
            : ghostValid
              ? "rgba(127, 201, 107, 0.22)"
              : "rgba(224, 80, 58, 0.38)";
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
      // The hull's edge stays visible through the piece, so you can see what's in bounds.
      drawRim(ctx, hullRows, cell, "#ff9a4a", 2.5);
    }
  });

  // The square under the held piece's top-left, snapped to the nearest one, or null when the
  // pointer is off the board.
  const anchorAt = useCallback(
    (clientX: number, clientY: number) => {
      const r = canvasRef.current!.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
      return {
        x: Math.round((clientX - r.left) / cell - PAD - grab.x),
        y: Math.round((clientY - r.top) / cell - PAD - grab.y),
      };
    },
    [cell, grab, cols, rows],
  );

  // Pointer tracking is on window so drags from the offers land here too.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef({ held, rot, flip, cells, anchorAt, onPlace });
  latest.current = { held, rot, flip, cells, anchorAt, onPlace };
  const track = useCallback(() => {
    const p = pointer.current;
    const h = p ? latest.current.anchorAt(p.x, p.y) : null;
    setHover((prev) => (prev?.x === h?.x && prev?.y === h?.y ? prev : h));
    onHoverChange(h !== null);
  }, [onHoverChange]);
  // Turning the piece moves its grab point, so re-snap without waiting for the pointer to move.
  useEffect(track, [track, anchorAt, rot, flip, held]);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch" && !touchTrack.on) return;
      pointer.current = { x: e.clientX, y: e.clientY };
      track();
      const d = drag.current;
      if (d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) d.moved = true;
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      const fromDrag = d.active && d.moved;
      const fromBoard = downOnBoard.current;
      d.active = false;
      downOnBoard.current = false;
      if (e.pointerType === "touch") touchTrack.on = false;
      if (e.button !== 0 || !(fromDrag || fromBoard)) return;
      const { held, rot, flip, anchorAt, onPlace } = latest.current;
      const a = anchorAt(e.clientX, e.clientY);
      if (!held || !a) return;
      const cells = placedCells(held, a.x, a.y, rot, flip);
      if (placementError(buildable.current, latest.current.cells, cells) === null) onPlace(a.x, a.y);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, track]);

  return (
    <div
      className="draft-board"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        downOnBoard.current = true;
        if (e.pointerType === "touch") {
          touchTrack.on = true;
          // A touch has no hover: put the piece where the finger lands straight away.
          pointer.current = { x: e.clientX, y: e.clientY };
          track();
        }
      }}
    >
      <canvas ref={canvasRef} className={held && hover ? "holding" : undefined} />
    </div>
  );
}


/**
 * Faint riveted floor plates for the buildable squares, with a rusty rim around the hull.
 * Dead squares (pockets too small for any piece) are darkened and hatched.
 */
function drawBay(ctx: CanvasRenderingContext2D, hullRows: string[], cell: number, dead: ReadonlySet<string>) {
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

  // Pockets nothing can fill: dark, with diagonal hatching.
  ctx.save();
  for (const k of dead) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    const x0 = x * cell;
    const y0 = y * cell;
    ctx.fillStyle = "#07080b";
    ctx.fillRect(x0, y0, cell, cell);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, cell, cell);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = -cell; t < cell; t += cell / 4) {
      ctx.moveTo(x0 + t, y0 + cell);
      ctx.lineTo(x0 + t + cell, y0);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  drawRim(ctx, hullRows, cell, "#8f4520", 2);
}

function insideHull(hullRows: string[], x: number, y: number): boolean {
  return (hullRows[y]?.[x] ?? ".") !== ".";
}

/** The rusty line around the hull's outer edge. */
function drawRim(ctx: CanvasRenderingContext2D, hullRows: string[], cell: number, color: string, width: number) {
  const inside = (x: number, y: number) => insideHull(hullRows, x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
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
