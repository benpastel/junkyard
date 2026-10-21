import { TEAMS, type ChatMessage, type PlayerInfo, type RoomView, type RoundResults } from "@ja/shared";
import { net } from "../net";
import { Chat } from "./Chat";

/** Tokens per column of a stack; a taller pile starts a new column beside it. */
const STACK_HEIGHT = 8;
/** Stagger between this round's tokens popping in, after the screen settles. */
const POP_START_MS = 450;
const POP_STEP_MS = 160;

export function Star() {
  return (
    <svg viewBox="-12 -12 24 24" className="token-icon">
      <path
        d="M0,-10.5 L3.1,-3.6 L10.4,-3.2 L4.8,1.6 L6.5,9 L0,5 L-6.5,9 L-4.8,1.6 L-10.4,-3.2 L-3.1,-3.6 Z"
        fill="#f2c443"
        stroke="#8a5a10"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A ship going up: the kill token. */
export function Boom() {
  const spikes = 9;
  const outer: string[] = [];
  const inner: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 5.2 : 11;
    const ri = i % 2 ? 2.6 : 6;
    outer.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
    inner.push(`${(Math.cos(a + 0.2) * ri).toFixed(2)},${(Math.sin(a + 0.2) * ri).toFixed(2)}`);
  }
  return (
    <svg viewBox="-12 -12 24 24" className="token-icon">
      <polygon points={outer.join(" ")} fill="#e8573b" stroke="#6e1e10" strokeWidth="1.2" strokeLinejoin="round" />
      <polygon points={inner.join(" ")} fill="#ffd25a" />
    </svg>
  );
}

/** A pile of tokens growing upward, this round's ones on top, popping in. */
function Stack({ total, fresh, icon, delay }: { total: number; fresh: number; icon: React.ReactNode; delay: number }) {
  const columns: number[][] = [];
  for (let i = 0; i < total; i++) {
    if (i % STACK_HEIGHT === 0) columns.push([]);
    columns[columns.length - 1]!.push(i);
  }
  return (
    <div className="stack">
      {columns.map((col, c) => (
        <div key={c} className="stack-col">
          {col.map((i) => {
            const n = i - (total - fresh);
            return (
              <span key={i} className={`token${n >= 0 ? " fresh" : ""}`} style={n >= 0 ? { animationDelay: `${delay + n * POP_STEP_MS}ms` } : undefined}>
                {icon}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function Results({ room, me, results, chat }: { room: RoomView; me: string | null; results: RoundResults | null; chat: ChatMessage[] }) {
  const isHost = room.hostId === me;
  const player = (id: string) => room.players.find((p) => p.id === id);
  const winner = results?.winnerId ? player(results.winnerId) : null;
  const teams = !!results?.teams;
  const winnerTeam = results?.winnerTeam ?? null;
  const title = teams
    ? winnerTeam !== null
      ? { text: `${TEAMS[winnerTeam]!.name} wins`, color: TEAMS[winnerTeam]!.color }
      : { text: "Draw", color: undefined }
    : { text: winner ? `${winner.name} wins` : "Draw", color: winner?.color };

  const row = (id: string) => results?.rows.find((r) => r.playerId === id);
  const wonNow = (p: PlayerInfo) => p.id === results?.winnerId || (winnerTeam !== null && row(p.id)?.team === winnerTeam);
  // Most stars first, then most kills.
  const ranked = [...room.players].sort((a, b) => b.wins - a.wins || b.totalKills - a.totalKills);
  // Everyone's new tokens pop in one player after another.
  let delay = POP_START_MS;

  const pile = (p: PlayerInfo) => {
    const freshStars = wonNow(p) ? 1 : 0;
    const freshKills = row(p.id)?.kills ?? 0;
    const starDelay = delay;
    const killDelay = delay + freshStars * POP_STEP_MS;
    delay += (freshStars + freshKills) * POP_STEP_MS;
    return (
      <div key={p.id} className={`pile${p.id === me ? " me" : ""}`}>
        <div className="stacks">
          <Stack total={p.wins} fresh={freshStars} icon={<Star />} delay={starDelay} />
          <Stack total={p.totalKills} fresh={freshKills} icon={<Boom />} delay={killDelay} />
        </div>
        <div className="pile-name">
          <span className="swatch" style={{ background: p.color }} />
          {p.name}
        </div>
      </div>
    );
  };

  // Team games: one group per team (winners first), labelled in the team's colour.
  const groups = teams
    ? TEAMS.map((team, t) => ({ team, t, players: ranked.filter((p) => p.team === t) }))
        .sort((a, b) => (b.t === winnerTeam ? 1 : 0) - (a.t === winnerTeam ? 1 : 0))
        .filter((g) => g.players.length)
    : [{ team: null, t: -1, players: ranked }];

  return (
    <div className="two-col">
      <div className="col-main">
        <h1 className="results-title" style={{ color: title.color ?? "var(--text)" }}>
          {title.text}
        </h1>

        <div className="scoreboard panel">
          {groups.map((g) => (
            <div key={g.t} className="pile-group">
              {g.team && (
                <h4 className="pile-group-name" style={{ color: g.team.color }}>
                  {g.team.name}
                </h4>
              )}
              <div className="piles">{g.players.map(pile)}</div>
            </div>
          ))}
        </div>

        <div className="button-row">
          {isHost && (
            <button className="primary big" onClick={() => net.send({ t: "nextRound" })}>
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
