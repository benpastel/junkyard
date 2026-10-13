import type { ChatMessage, RoomView, RoundResults } from "@ja/shared";
import { net } from "../net";
import { Chat } from "./Chat";

export function Results({ room, me, results, chat }: { room: RoomView; me: string | null; results: RoundResults | null; chat: ChatMessage[] }) {
  const isHost = room.hostId === me;
  const player = (id: string) => room.players.find((p) => p.id === id);
  const winner = results?.winnerId ? player(results.winnerId) : null;
  const rows = [...(results?.rows ?? [])].sort((a, b) => a.place - b.place);

  return (
    <div className="two-col">
      <div className="col-main">
        <h1 className="results-title" style={{ color: winner?.color ?? "var(--text)" }}>
          {winner ? `${winner.name} wins` : "Draw"}
        </h1>

        <table className="results panel">
          <thead>
            <tr>
              <th>#</th>
              <th className="left">Pilot</th>
              <th>Kills</th>
              <th>Destroyed</th>
              <th>Lost</th>
              <th>Survived</th>
              <th>Wins</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = player(r.playerId);
              return (
                <tr key={r.playerId} className={r.playerId === me ? "me" : ""}>
                  <td className="mono">{r.place}</td>
                  <td className="left">
                    <span className="pilot">
                      <span className="swatch" style={{ background: p?.color }} />
                      {p?.name ?? "?"}
                    </span>
                  </td>
                  <td className="mono">{r.kills}</td>
                  <td className="mono">{r.cellsDestroyed}</td>
                  <td className="mono">{r.cellsLost}</td>
                  <td className="mono">{Math.round(r.survivedSeconds)}s</td>
                  <td className="mono">{p?.wins ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {isHost && (
          <div className="button-row">
            <button className="primary big" onClick={() => net.send({ t: "nextRound" })}>
              Next round
            </button>
            <button onClick={() => net.send({ t: "toLobby" })}>Lobby</button>
          </div>
        )}
      </div>
      <Chat messages={chat} players={room.players} />
    </div>
  );
}
