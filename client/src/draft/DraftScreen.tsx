import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dir, PlayerId, PlayerInfo } from "@ja/shared";
import {
  POOL_ENABLED,
  transformCells,
  type DraftAction,
  type DraftView,
  type Piece,
} from "@ja/shared/draft";
import { BOARD_PAD, Board, type DragState } from "./Board";
import { PIECE_PAD, PieceCanvas } from "./PieceCanvas";
import { RivalShip } from "./RivalShip";
import { FullscreenButton } from "../ui/FullscreenButton";
import { KeyButton } from "../ui/KeyButton";
import "./draft.css";

export function DraftScreen(props: {
  view: DraftView;
  me: PlayerId;
  /** performance.now()-based ms deadline, or null when there's no time limit. */
  endsAt: number | null;
  act: (a: DraftAction) => void;
  players: PlayerInfo[];
  /** The Done vote; omitted where there's nobody to wait for (the sandbox). */
  done?: DoneVote;
}) {
  const { view, me, endsAt, act, players, done } = props;
  const color = players.find((p) => p.id === me)?.color ?? "#e8743b";
  // Each piece's own orientation, by id; pieces not listed are upright.
  const [orients, setOrients] = useState<Record<string, Orient>>({});
  const orientOf = (id: string): Orient => orients[id] ?? UPRIGHT;
  const [overBoard, setOverBoard] = useState(false);
  // Where the pointer holds the piece, in cells from its top-left corner.
  const [grab, setGrab] = useState({ x: 0, y: 0 });
  // The piece we just asked to take, shown as held before the server confirms.
  const [pending, setPending] = useState<Piece | null>(null);
  // The piece we just asked to place, hidden until the server confirms (or a new view arrives).
  const [placing, setPlacing] = useState<string | null>(null);
  const drag = useRef<DragState>({
    active: false,
    startX: 0,
    startY: 0,
    moved: false,
  });

  useEffect(() => setPlacing(null), [view]);

  // The offers stay put while you hold one, so a pick is still valid while it's among them.
  const pendingStillValid =
    pending !== null &&
    (view.offers.some((p) => p.id === pending.id) ||
      view.pool.some((p) => p.id === pending.id));
  const held0 = pendingStillValid ? pending : view.held;
  const held = held0 && held0.id === placing ? null : held0;

  const heldId = held?.id ?? null;
  const { rot, flip } = heldId ? orientOf(heldId) : UPRIGHT;
  const heldShape = useMemo(
    () => (held ? transformCells(held.cells, rot, flip) : null),
    [held, rot, flip],
  );
  const heldBox = useRef({ w: 1, h: 1 });
  if (heldShape) heldBox.current = shapeBox(heldShape);

  // Rotate and flip turn only the held piece (about the pointer), or, with nothing held, every offer.
  const handIds = [...view.offers, ...view.pool].map((p) => p.id).join(" ");
  const turn = useCallback(
    (f: (o: Orient) => Orient) => {
      const ids = heldId ? [heldId] : handIds.split(" ").filter(Boolean);
      setOrients((all) => {
        const next = { ...all };
        for (const id of ids) next[id] = f(all[id] ?? UPRIGHT);
        return next;
      });
    },
    [heldId, handIds],
  );

  const rotate = useCallback(
    (by: 1 | -1) => {
      const { w, h } = heldBox.current;
      if (heldId)
        setGrab((g) =>
          by === 1 ? { x: h - g.y, y: g.x } : { x: g.y, y: w - g.x },
        );
      turn((o) => ({ ...o, rot: ((o.rot + by + 4) % 4) as Dir }));
    },
    [heldId, turn],
  );

  const reroll = useCallback(() => {
    if (view.dealing) return;
    act({ type: "reroll" });
    setPending(null);
  }, [act, view.dealing]);

  const discard = useCallback(() => {
    if (!held) return;
    act({ type: "discard" });
    setPending(null);
  }, [act, held]);

  const take = (
    piece: Piece,
    from: "offer" | "pool",
    at: { x: number; y: number },
  ) => {
    if (held?.id === piece.id) {
      discard();
      return;
    }
    setGrab(at);
    // Switching straight to another offer is fine; a pool piece has to be swapped back first.
    if (held && from === "pool") act({ type: "discard" });
    act(
      from === "offer"
        ? { type: "takeOffer", pieceId: piece.id }
        : { type: "takePool", pieceId: piece.id },
    );
    setPending(piece);
  };

  const place = useCallback(
    (x: number, y: number) => {
      if (!held) return;
      act({ type: "place", x, y, rot, flip });
      setPlacing(held.id);
      setPending(null);
    },
    [act, held, rot, flip],
  );

  // Always mirror left-right as seen on screen. The transform mirrors before rotating, and
  // mirroring after a rotation r is the same as mirroring first and rotating by -r.
  const toggleFlip = useCallback(() => {
    const { w } = heldBox.current;
    if (heldId) setGrab((g) => ({ x: w - g.x, y: g.y }));
    turn((o) => ({ rot: ((4 - o.rot) % 4) as Dir, flip: !o.flip }));
  }, [heldId, turn]);

  // Keyboard: Q / E rotate, F flips, Esc puts the piece back, R rerolls the offers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      const k = e.key.toLowerCase();
      if (k === "q") rotate(-1);
      else if (k === "e") rotate(1);
      else if (k === "r") reroll();
      else if (k === "f") toggleFlip();
      else if (k === "escape") discard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rotate, toggleFlip, discard, reroll]);

  // Right-click rotates while holding; wheel rotates too.
  useEffect(() => {
    let acc = 0;
    const onContext = (e: MouseEvent) => {
      if (!heldId) return;
      e.preventDefault();
      rotate(1);
    };
    const onWheel = (e: WheelEvent) => {
      if (!heldId) return;
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) >= 40) {
        rotate(acc > 0 ? 1 : -1);
        acc = 0;
      }
    };
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("wheel", onWheel);
    };
  }, [heldId, rotate]);

  const status = (
    <>
      {endsAt !== null && <Timer endsAt={endsAt} />}
      {done && (
        <button
          className={`draft-done${done.voted || view.full ? " on" : ""}`}
          onClick={done.toggle}
          disabled={view.full}
        >
          Done
          {done.needed > 1 && (
            <span className="mono">
              {" "}
              {done.votes}/{done.needed}
            </span>
          )}
        </button>
      )}
    </>
  );

  const rivals = view.rivals
    .map((r) => ({ ...r, info: players.find((p) => p.id === r.playerId) }))
    .filter((r) => r.info);

  // One scale for everything: the offers sit at the board's size, so a piece never resizes
  // between being picked up and being placed. Phones (compact) are too narrow for three offers
  // at board size, so there the offers are smaller and the piece grows as you lift it.
  const rootRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const cols = view.hullRows[0]!.length;
  const rows = view.hullRows.length;
  const [{ cell, offerCell, compact }, setLayout] = useState({
    cell: 32,
    offerCell: 32,
    compact: false,
  });
  useLayoutEffect(() => {
    const fit = () => {
      const r = rootRef.current!.getBoundingClientRect();
      const tools = toolsRef.current!.getBoundingClientRect().height;
      const offersW =
        (r.width - 2 * EDGE - 2 * GAP) / (3 * (5 + PIECE_PAD * 2));
      if (r.width < COMPACT_WIDTH) {
        const status = statusRef.current?.getBoundingClientRect().height ?? 0;
        const offer = Math.max(
          10,
          Math.floor(Math.min(offersW, (r.height * 0.22) / OFFER_CELLS)),
        );
        const h =
          (r.height -
            2 * EDGE -
            3 * GAP -
            tools -
            status -
            OFFER_CELLS * offer) /
          (rows + BOARD_PAD * 2);
        const w = (r.width - 2 * EDGE) / (cols + BOARD_PAD * 2);
        const board = Math.max(
          10,
          Math.min(MAX_CELL, Math.floor(Math.min(h, w))),
        );
        setLayout({
          cell: board,
          offerCell: Math.min(offer, board),
          compact: true,
        });
        return;
      }
      const h =
        (r.height - 2 * EDGE - 2 * GAP - tools) /
        (OFFER_CELLS + rows + BOARD_PAD * 2);
      const w =
        (r.width - 2 * EDGE - 2 * SIDE - 2 * GAP) / (cols + BOARD_PAD * 2);
      const c = Math.max(
        14,
        Math.min(MAX_CELL, Math.floor(Math.min(h, w, offersW))),
      );
      setLayout({ cell: c, offerCell: c, compact: false });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(rootRef.current!);
    return () => ro.disconnect();
  }, [cols, rows]);

  return (
    <div
      className={`draft${compact ? " compact" : ""}`}
      ref={rootRef}
      style={{ padding: EDGE, gap: GAP }}
    >
      {compact && (
        <div className="draft-status-bar" ref={statusRef}>
          {status}
          <FullscreenButton />
        </div>
      )}
      <section className="draft-hand">
        <div
          className="draft-offers"
          style={{ height: OFFER_CELLS * offerCell, gap: GAP }}
        >
          {view.dealing ? (
            <div className="draft-dealing">
              <HourglassIcon />
            </div>
          ) : (
            view.offers.map((p) => (
              <PieceCard
                key={p.id}
                piece={p}
                cells={transformCells(
                  p.cells,
                  orientOf(p.id).rot,
                  orientOf(p.id).flip,
                )}
                cell={offerCell}
                color={color}
                held={held?.id === p.id}
                onTake={(at) => take(p, "offer", at)}
                drag={drag}
              />
            ))
          )}
        </div>
        <div className="draft-tools" ref={toolsRef}>
          <div className="draft-rotate-pair">
            <KeyButton
              title="Rotate counter-clockwise"
              keyLabel="Q"
              icon={<RotateIcon ccw />}
              onClick={() => rotate(-1)}
            />
            <KeyButton
              title="Rotate clockwise"
              keyLabel="E"
              icon={<RotateIcon />}
              onClick={() => rotate(1)}
            />
          </div>
          <KeyButton
            title="Flip"
            keyLabel="F"
            icon={<FlipIcon />}
            onClick={toggleFlip}
            active={flip}
          />
          <span className="draft-tools-gap" />
          <KeyButton
            title="New offers"
            keyLabel="R"
            icon={<DiceIcon />}
            onClick={reroll}
            active={view.dealing}
            disabled={view.dealing}
          />
          {/* Only there while holding; hidden rather than removed so the row doesn't shift. */}
          <span style={{ visibility: held ? "visible" : "hidden" }}>
            <KeyButton
              title="Put back"
              keyLabel="Esc"
              icon={<DiscardIcon />}
              onClick={discard}
            />
          </span>
        </div>
      </section>

      <div
        className="draft-body"
        style={{
          gridTemplateColumns: compact
            ? "minmax(0, 1fr)"
            : `${SIDE}px minmax(0, 1fr) ${SIDE}px`,
          gap: GAP,
        }}
      >
        {!compact && (
          <aside className="draft-side draft-status">{status}</aside>
        )}

        <main className="draft-main">
          <Board
            hullRows={view.hullRows}
            cells={view.cells}
            held={held}
            rot={rot}
            flip={flip}
            grab={grab}
            cell={cell}
            color={color}
            drag={drag}
            onHoverChange={setOverBoard}
            onPlace={place}
          />
        </main>

        {!compact && (
          <aside className="draft-side">
            <FullscreenButton className="draft-fullscreen" />
            {POOL_ENABLED && (
              <section className="draft-pool-section">
                <div className="draft-pool">
                  {view.pool.map((p) => (
                    <PieceCard
                      key={p.id}
                      piece={p}
                      cell={14}
                      color={color}
                      small
                      held={held?.id === p.id}
                      onTake={(at) => take(p, "pool", at)}
                      drag={drag}
                    />
                  ))}
                </div>
              </section>
            )}
            {rivals.length > 0 && (
              <div className="draft-rivals">
                {rivals.map((r) => (
                  <RivalShip
                    key={r.playerId}
                    hullRows={r.hullRows}
                    cells={r.cells}
                    color={r.info!.color}
                    name={r.info!.name}
                  />
                ))}
              </div>
            )}
          </aside>
        )}
      </div>

      {heldShape && !overBoard && (
        <FloatingPiece
          cells={heldShape}
          color={color}
          cell={cell}
          grab={grab}
        />
      )}
    </div>
  );
}

/** Layout, in CSS pixels: page margin, gaps, and the side columns beside the board. */
const EDGE = 16;
const GAP = 12;
const SIDE = 180;

interface Orient {
  rot: Dir;
  flip: boolean;
}
const UPRIGHT: Orient = { rot: 0, flip: false };
const MAX_CELL = 64;
/** Narrower than this (phones), the layout stacks: status, offers, buttons, board. */
const COMPACT_WIDTH = 720;
/** On touch, a picked-up piece floats this many squares above the finger so it stays in view. */
const TOUCH_LIFT = 1.2;
/** Height of the offer row, in squares: room for a piece five squares tall. */
const OFFER_CELLS = 5.6;

function shapeBox(cells: readonly { x: number; y: number }[]) {
  return {
    w: Math.max(...cells.map((c) => c.x)) + 1,
    h: Math.max(...cells.map((c) => c.y)) + 1,
  };
}

const ICON = {
  width: 26,
  height: 26,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

// Rotate and flip show a little L before (faint) and after (solid).
function MiniL(props: {
  x: number;
  y: number;
  turned?: boolean;
  mirror?: boolean;
  ghost?: boolean;
}) {
  const s = 5;
  let cells: [number, number][] = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 2],
  ];
  if (props.mirror) cells = cells.map(([x, y]) => [1 - x, y]);
  // A quarter turn clockwise.
  if (props.turned) cells = cells.map(([x, y]) => [2 - y, x]);
  return (
    <g opacity={props.ghost ? 0.35 : 1}>
      {cells.map(([cx, cy]) => (
        <rect
          key={`${cx},${cy}`}
          x={props.x + cx * s}
          y={props.y + cy * s}
          width={s - 1}
          height={s - 1}
          fill="currentColor"
          stroke="none"
          rx={0.6}
        />
      ))}
    </g>
  );
}

const GLYPH = { ...ICON, width: 36, height: 36, viewBox: "0 0 32 32" } as const;

function RotateIcon({ ccw }: { ccw?: boolean }) {
  return (
    <svg
      {...GLYPH}
      style={ccw ? { transform: "scaleX(-1)" } : undefined}
      aria-hidden
    >
      <MiniL x={2} y={13} ghost />
      <MiniL x={15} y={16} turned />
      <path d="M5 10C7 3 19 2 23 10" />
      <path d="M24.5 5.5 23.3 10.4 18.6 9" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg {...GLYPH} aria-hidden>
      <path d="M16 2v26" strokeDasharray="2 2.5" strokeWidth={1.5} />
      <MiniL x={3} y={9} ghost />
      <MiniL x={19} y={9} mirror />
    </svg>
  );
}

function DiceIcon() {
  return (
    <svg {...ICON} width={30} height={30} className="dice" aria-hidden>
      <rect x={3.5} y={3.5} width={17} height={17} rx={3} strokeWidth={2.2} />
      {[
        [8.5, 8.5],
        [15.5, 8.5],
        [12, 12],
        [8.5, 15.5],
        [15.5, 15.5],
      ].map(([cx, cy]) => (
        <circle
          key={`${cx},${cy}`}
          cx={cx}
          cy={cy}
          r={1.4}
          fill="currentColor"
          stroke="none"
        />
      ))}
    </svg>
  );
}

function HourglassIcon() {
  return (
    <svg {...ICON} className="hourglass" aria-hidden>
      <path d="M6 3h12M6 21h12" />
      <path d="M7 3c0 5 10 5 10 9s-10 4-10 9" />
      <path d="M17 3c0 5-10 5-10 9s10 4 10 9" />
    </svg>
  );
}

function DiscardIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function PieceCard(props: {
  piece: Piece;
  /** Cells to draw, if not the piece's own (e.g. turned the way the hand is). */
  cells?: Piece["cells"];
  cell: number;
  color: string;
  small?: boolean;
  /** In hand: the card stands empty while the piece follows the pointer. */
  held: boolean;
  /** Called with where on the piece it was grabbed, in cells from its top-left corner. */
  onTake: (at: { x: number; y: number }) => void;
  drag: React.MutableRefObject<DragState>;
}) {
  const { piece, cell, color, small, held, onTake, drag } = props;
  const cells = props.cells ?? piece.cells;
  return (
    <button
      className={`piece-card${small ? " small" : ""}${held ? " active held" : ""}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag.current = {
          active: true,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        // Keep the grabbed spot under the pointer (clamped onto the piece's box).
        const { w, h } = shapeBox(cells);
        const canvas = e.currentTarget.querySelector("canvas");
        const r = canvas?.getBoundingClientRect();
        const at = r
          ? {
              x: (e.clientX - r.left) / cell - PIECE_PAD,
              y: (e.clientY - r.top) / cell - PIECE_PAD,
            }
          : { x: w / 2, y: h / 2 };
        // A finger would hide the piece, so on touch it's held from below, lifted above the finger.
        if (e.pointerType === "touch") onTake({ x: w / 2, y: h + TOUCH_LIFT });
        else
          onTake({
            x: clamp(at.x, 0.2, w - 0.2),
            y: clamp(at.y, 0.2, h - 0.2),
          });
      }}
    >
      {!held && <PieceCanvas cells={cells} cell={cell} color={color} />}
    </button>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** The held piece, following the pointer when it isn't over the grid, at the board's scale. */
function FloatingPiece(props: {
  cells: ReturnType<typeof transformCells>;
  color: string;
  cell: number;
  grab: { x: number; y: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { cell } = props;
  const ox = (PIECE_PAD + props.grab.x) * cell;
  const oy = (PIECE_PAD + props.grab.y) * cell;

  useLayoutEffect(() => {
    const el = ref.current!;
    const place = (x: number, y: number) => {
      el.style.transform = `translate(${x - ox}px, ${y - oy}px)`;
    };
    place(lastPointer.x, lastPointer.y);
    const move = (e: PointerEvent) => place(e.clientX, e.clientY);
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [ox, oy]);

  return (
    <div ref={ref} className="draft-floating">
      <PieceCanvas cells={props.cells} cell={cell} color={props.color} />
    </div>
  );
}

const lastPointer = { x: -1000, y: -1000 };
if (typeof window !== "undefined") {
  window.addEventListener("pointermove", (e) => {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
  });
  window.addEventListener("pointerdown", (e) => {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
  });
}

export interface DoneVote {
  /** I've clicked Done. */
  voted: boolean;
  votes: number;
  needed: number;
  toggle: () => void;
}

function Timer({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div
      className={`draft-timer${left <= 10 ? " urgent" : ""}`}
    >{`${mm}:${ss}`}</div>
  );
}
