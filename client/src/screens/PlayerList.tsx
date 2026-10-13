import type { PlayerInfo } from "@ja/shared";
import { net } from "../net";

export function PlayerList({ players, hostId, me, canKick }: { players: PlayerInfo[]; hostId: string; me: string | null; canKick: boolean }) {
  return (
    <ul className="player-list">
      {players.map((p) => (
        <li key={p.id} className={p.connected ? "" : "disconnected"}>
          <span className="swatch" style={{ background: p.color }} />
          <span className="player-name">
            {p.name}
            {p.id === me && <span className="tag">you</span>}
            {p.id === hostId && <span className="tag">host</span>}
            {p.isBot && <span className="tag">bot</span>}
          </span>
          {p.wins > 0 && <span className="wins mono">{"★".repeat(Math.min(p.wins, 5))}{p.wins > 5 ? p.wins : ""}</span>}
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
