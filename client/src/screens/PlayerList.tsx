import { useEffect, useRef, useState } from "react";
import { PLAYER_COLORS, type PlayerInfo } from "@ja/shared";
import { net } from "../net";
import { rememberName } from "./Lobby";
import { HullOutline, RandomHull } from "./HullOutline";

export function PlayerList(props: {
  players: PlayerInfo[];
  hostId: string;
  me: string | null;
  canKick: boolean;
  showHull?: boolean;
  /** Team games: a button on each row this viewer may move to the other team. */
  swapTeam?: (p: PlayerInfo) => void;
  /** Your own row's name and colour can be clicked to change them. */
  editable?: boolean;
  /** Every player's colours, for greying out taken swatches; omit to lock colour (team shades). */
  colorsInUse?: string[];
}) {
  const { players, hostId, me, canKick, showHull, swapTeam, editable, colorsInUse } = props;
  const canSwap = (p: PlayerInfo) => !!swapTeam && (p.id === me || me === hostId);
  return (
    <ul className="player-list">
      {players.map((p) => (
        <li key={p.id} className={p.connected ? "" : "disconnected"}>
          {editable && p.id === me && colorsInUse ? (
            <ColorPick color={p.color} taken={colorsInUse.filter((c) => c !== p.color)} />
          ) : (
            <span className="swatch" style={{ background: p.color }} />
          )}
          {showHull && (
            <span className="player-hull" title={p.hullChoice}>
              {p.hullChoice === "random" ? <RandomHull size={22} /> : <HullOutline hull={p.hullChoice} size={22} />}
            </span>
          )}
          <span className="player-name">
            {editable && p.id === me ? <EditableName name={p.name} /> : p.name}
            {p.id === me && <span className="tag">you</span>}
            {p.id === hostId && <span className="tag">host</span>}
            {p.isBot && <span className="tag">bot</span>}
          </span>
          {p.wins > 0 && <span className="wins mono">{"★".repeat(Math.min(p.wins, 5))}{p.wins > 5 ? p.wins : ""}</span>}
          {canSwap(p) && (
            <button className="icon-btn" aria-label={`Switch ${p.name}'s team`} onClick={() => swapTeam!(p)}>
              ⇄
            </button>
          )}
          {canKick && p.isBot && (
            <button className="icon-btn" aria-label={`Remove ${p.name}`} onClick={() => net.send({ t: "removeBot", playerId: p.id })}>
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Your own name: click to edit; Enter or clicking away keeps it, Escape drops it. */
function EditableName({ name }: { name: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button className="name-edit" aria-label="Change your name" onClick={() => setDraft(name)}>
        {name}
      </button>
    );
  }
  const commit = () => {
    const n = draft.trim();
    if (n && n !== name) {
      rememberName(n);
      net.send({ t: "setName", name: n });
    }
    setDraft(null);
  };
  return (
    <input
      className="name-input"
      value={draft}
      autoFocus
      maxLength={16}
      spellCheck={false}
      autoComplete="off"
      aria-label="Your name"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

/** Your own colour square: click for the swatches; picking one, clicking elsewhere or Escape closes them. */
function ColorPick({ color, taken }: { color: string; taken: string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span className="color-pick" ref={ref}>
      <button className="swatch swatch-edit" style={{ background: color }} aria-label="Change colour" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <span className="swatch-pop">
          {PLAYER_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch-option${c === color ? " on" : ""}`}
              style={{ background: c }}
              disabled={taken.includes(c)}
              aria-label={`Colour ${c}`}
              onClick={() => {
                if (c !== color) net.send({ t: "setColor", color: c });
                setOpen(false);
              }}
            />
          ))}
        </span>
      )}
    </span>
  );
}
