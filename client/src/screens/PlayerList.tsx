import type { PlayerInfo } from "@ja/shared";
import { net } from "../net";
import { HullOutline, RandomHull } from "./HullOutline";

export function PlayerList(props: {
  players: PlayerInfo[];
  hostId: string;
  me: string | null;
  canKick: boolean;
  showHull?: boolean;
  /** Team games: a button on each row this viewer may move to the other team. */
  swapTeam?: (p: PlayerInfo) => void;
}) {
  const { players, hostId, me, canKick, showHull, swapTeam } = props;
  const canSwap = (p: PlayerInfo) => !!swapTeam && (p.id === me || me === hostId);
  return (
    <ul className="player-list">
      {players.map((p) => (
        <li key={p.id} className={p.connected ? "" : "disconnected"}>
          <span className="swatch" style={{ background: p.color }} />
          {showHull && (
            <span className="player-hull" title={p.hullChoice}>
              {p.hullChoice === "random" ? <RandomHull size={22} /> : <HullOutline hull={p.hullChoice} size={22} />}
            </span>
          )}
          <span className="player-name">
            {p.name}
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
