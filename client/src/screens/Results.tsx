import { TEAMS, type ChatMessage, type RoomView, type RoundResultRow, type RoundResults } from "@ja/shared";
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
  const teams = !!results?.teams;
  const winnerTeam = results?.winnerTeam ?? null;
  const title = teams
    ? winnerTeam !== null
      ? { text: `${TEAMS[winnerTeam]!.name} wins`, color: TEAMS[winnerTeam]!.color }
      : { text: "Draw", color: undefined }
    : { text: winner ? `${winner.name} wins` : "Draw", color: winner?.color };
  // Team games: the winning team first, each team's pilots by kills, then cells destroyed.
  const teamOrder = TEAMS.map((_, t) => t).sort((a, b) => (b === winnerTeam ? 1 : 0) - (a === winnerTeam ? 1 : 0));
  const byTeam = teamOrder.map((t) => ({
    t,
    rows: rows.filter((r) => r.team === t).sort((a, b) => b.kills - a.kills || b.cellsDestroyed - a.cellsDestroyed),
  }));

  const pilotRow = (r: RoundResultRow) => {
    const p = player(r.playerId);
    return (
      <tr key={r.playerId} className={r.playerId === me ? "me" : ""}>
        {!teams && <td className="mono">{r.place}</td>}
        <td className="left">
          <span className="pilot">
            <span className="swatch" style={{ background: p?.color }} />
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
  };

  return (
    <div className="two-col">
      <div className="col-main">
        <h1 className="results-title" style={{ color: title.color ?? "var(--text)" }}>
          {title.text}
        </h1>

        <div className="results-wrap">
          <table className="results panel">
            <thead>
              <tr className="group">
                <th colSpan={teams ? 1 : 2} />
                <th colSpan={2}>Round</th>
                <th colSpan={3} className="total">
                  Total
                </th>
              </tr>
              <tr>
                {!teams && <th>#</th>}
                <th className="left">Pilot</th>
                <th>Kills</th>
                <th>Destroyed</th>
                <th className="total">Kills</th>
                <th>Destroyed</th>
                <th>Wins</th>
              </tr>
            </thead>
            <tbody>
              {teams
                ? byTeam.map(({ t, rows }) => [
                    <tr key={`team${t}`} className="team-row">
                      <td className="left" style={{ color: TEAMS[t]!.color }}>
                        {TEAMS[t]!.name}
                      </td>
                      <td className="mono">{rows.reduce((n, r) => n + r.kills, 0)}</td>
                      <td className="mono">{rows.reduce((n, r) => n + r.cellsDestroyed, 0)}</td>
                      <td className="total" />
                      <td />
                      <td />
                    </tr>,
                    ...rows.map(pilotRow),
                  ])
                : rows.map(pilotRow)}
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
