import type { ChatMessage, RoomView, RoundResults } from "@ja/shared";
import { net } from "../net";
import { Chat } from "./Chat";

export function Results({
  room,
  me,
  results,
  chat,
}: {
  room: RoomView;
  me: string | null;
  results: RoundResults | null;
  chat: ChatMessage[];
}) {
  const isHost = room.hostId === me;
  const player = (id: string) => room.players.find((p) => p.id === id);
  const winner = results?.winnerId ? player(results.winnerId) : null;
  const rows = [...(results?.rows ?? [])].sort((a, b) => a.place - b.place);

  return (
    <div className="two-col">
      <div className="col-main">
        <h1
          className="results-title"
          style={{ color: winner?.color ?? "var(--text)" }}
        >
          {winner ? `${winner.name} wins` : "Draw"}
        </h1>

        <div className="results-wrap">
          <table className="results panel">
            <thead>
              <tr className="group">
                <th colSpan={2} />
                <th colSpan={2}>Round</th>
                <th colSpan={3} className="total">
                  Total
                </th>
              </tr>
              <tr>
                <th>#</th>
                <th className="left">Pilot</th>
                <th>Kills</th>
                <th>Destroyed</th>
                <th className="total">Kills</th>
                <th>Destroyed</th>
                <th>Wins</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = player(r.playerId);
                return (
                  <tr
                    key={r.playerId}
                    className={r.playerId === me ? "me" : ""}
                  >
                    <td className="mono">{r.place}</td>
                    <td className="left">
                      <span className="pilot">
                        <span
                          className="swatch"
                          style={{ background: p?.color }}
                        />
                        {p?.name ?? "?"}
                      </span>
                    </td>
                    <td className="mono">{r.kills}</td>
                    <td className="mono">{r.cellsDestroyed}</td>
                    <td className="mono total">{p?.totalKills ?? 0}</td>
                    <td className="mono">{p?.totalDestroyed ?? 0}</td>
                    <td className="mono">{p?.wins ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="button-row">
          {isHost && (
            <button
              className="primary big"
              onClick={() => net.send({ t: "nextRound" })}
            >
              Next round
            </button>
          )}
          <button onClick={() => net.quit()}>Quit</button>
        </div>
      </div>
      <Chat messages={chat} players={room.players} />
    </div>
  );
}
