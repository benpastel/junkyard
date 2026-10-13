import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dir, PlayerId, PlayerInfo } from "@ja/shared";
import { transformCells, type DraftAction, type DraftView, type Piece } from "@ja/shared/draft";
import { Board, type DragState } from "./Board";
import { PieceCanvas } from "./PieceCanvas";
import { RivalShip } from "./RivalShip";
import "./draft.css";

export function DraftScreen(props: {
  view: DraftView;
  me: PlayerId;
  /** performance.now()-based ms deadline. */
  endsAt: number;
  act: (a: DraftAction) => void;
  players: PlayerInfo[];
}) {
  const { view, me, endsAt, act, players } = props;
  const color = players.find((p) => p.id === me)?.color ?? "#e8743b";
  const [rot, setRot] = useState<Dir>(0);
  const [flip, setFlip] = useState(false);
  const [overBoard, setOverBoard] = useState(false);
  // The piece we just asked to take, shown as held before the server confirms.
  const [pending, setPending] = useState<Piece | null>(null);
  // The piece we just asked to place, hidden until the server confirms (or a new view arrives).
  const [placing, setPlacing] = useState<string | null>(null);
  const drag = useRef<DragState>({ active: false, startX: 0, startY: 0, moved: false });

  useEffect(() => setPlacing(null), [view]);

  const pendingStillValid =
    pending !== null &&
    !view.held &&
    (view.offers.some((p) => p.id === pending.id) || view.pool.some((p) => p.id === pending.id));
  const held0 = view.held ?? (pendingStillValid ? pending : null);
  const held = held0 && held0.id === placing ? null : held0;

  // New piece in hand: start upright.
  const heldId = held?.id ?? null;
  useEffect(() => {
    setRot(0);
    setFlip(false);
  }, [heldId]);

  const rotate = useCallback((by: 1 | -1) => setRot((r) => (((r + by + 4) % 4) as Dir)), []);

  const take = (piece: Piece, from: "offer" | "pool") => {
    if (held?.id === piece.id) return;
    if (held) act({ type: "discard" });
    act(from === "offer" ? { type: "takeOffer", pieceId: piece.id } : { type: "takePool", pieceId: piece.id });
    setPending(piece);
  };

  const discard = useCallback(() => {
    if (!held) return;
    act({ type: "discard" });
    setPending(null);
  }, [act, held]);

  const place = useCallback(
    (x: number, y: number) => {
      if (!held) return;
      act({ type: "place", x, y, rot, flip });
      setPlacing(held.id);
      setPending(null);
    },
    [act, held, rot, flip],
  );

  // Keyboard: R rotates, F flips, Esc discards.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === "r") rotate(e.shiftKey ? -1 : 1);
      else if (k === "f") setFlip((f) => !f);
      else if (k === "escape") discard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rotate, discard]);

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

  const heldShape = useMemo(() => (held ? transformCells(held.cells, rot, flip) : null), [held, rot, flip]);

  const rivals = view.rivals
    .map((r) => ({ ...r, info: players.find((p) => p.id === r.playerId) }))
    .filter((r) => r.info);

  return (
    <div className="draft">
      <aside className="draft-side">
        {heldShape && (
          <section className="draft-hand">
            <div className="piece-card held">
              <PieceCanvas cells={heldShape} cell={26} color={color} />
            </div>
            <button className="draft-discard" onClick={discard}>
              Discard
            </button>
          </section>
        )}
        {view.offers.length > 0 && (
          <section>
            <h3>Offers</h3>
            <div className="draft-offers">
              {view.offers.map((p) => (
                <PieceCard key={p.id} piece={p} cell={26} color={color} active={held?.id === p.id} onTake={() => take(p, "offer")} drag={drag} />
              ))}
            </div>
          </section>
        )}
      </aside>

      <main className="draft-main">
        <Timer endsAt={endsAt} />
        <Board
          hullRows={view.hullRows}
          cells={view.cells}
          held={held}
          rot={rot}
          flip={flip}
          color={color}
          drag={drag}
          onHoverChange={setOverBoard}
          onPlace={place}
        />
      </main>

      <aside className="draft-side">
        <section className="draft-pool-section">
          <h3>Pool</h3>
          <div className="draft-pool">
            {view.pool.map((p) => (
              <PieceCard key={p.id} piece={p} cell={14} color={color} small active={held?.id === p.id} onTake={() => take(p, "pool")} drag={drag} />
            ))}
          </div>
        </section>
        {rivals.length > 0 && (
          <section>
            <h3>Rivals</h3>
            <div className="draft-rivals">
              {rivals.map((r) => (
                <RivalShip key={r.playerId} hullRows={view.hullRows} cells={r.cells} color={r.info!.color} name={r.info!.name} />
              ))}
            </div>
          </section>
        )}
      </aside>

      {heldShape && !overBoard && <FloatingPiece cells={heldShape} color={color} />}
    </div>
  );
}

function PieceCard(props: {
  piece: Piece;
  cell: number;
  color: string;
  small?: boolean;
  active: boolean;
  onTake: () => void;
  drag: React.MutableRefObject<DragState>;
}) {
  const { piece, cell, color, small, active, onTake, drag } = props;
  return (
    <button
      className={`piece-card${small ? " small" : ""}${active ? " active" : ""}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag.current = { active: true, startX: e.clientX, startY: e.clientY, moved: false };
        onTake();
      }}
    >
      <PieceCanvas cells={piece.cells} cell={cell} color={color} />
    </button>
  );
}

/** The held piece, following the cursor when it isn't over the grid. */
function FloatingPiece(props: { cells: ReturnType<typeof transformCells>; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const cell = 40;
  const w = (Math.max(...props.cells.map((c) => c.x)) + 1) * cell;
  const h = (Math.max(...props.cells.map((c) => c.y)) + 1) * cell;

  useLayoutEffect(() => {
    const el = ref.current!;
    const place = (x: number, y: number) => {
      el.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px)`;
    };
    const last = lastPointer;
    place(last.x, last.y);
    const move = (e: PointerEvent) => place(e.clientX, e.clientY);
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [w, h]);

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

function Timer({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  return <div className={`draft-timer${left <= 10 ? " urgent" : ""}`}>{`${mm}:${ss}`}</div>;
}
