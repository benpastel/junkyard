// Results screen with made-up standings: ?sandbox=results[&teams=1]
import { DEFAULT_SETTINGS, PLAYER_COLORS, TEAMS, type PlayerInfo, type RoomView, type RoundResults } from "@ja/shared";
import { Results } from "./screens/Results";

const params = new URLSearchParams(location.search);
const teams = params.has("teams");
const STATS: [string, number, number, number][] = [
  // name, wins, total kills, kills this round
  ["Benji", 3, 9, 2],
  ["Rustbucket", 1, 5, 1],
  ["Scrapjaw", 2, 14, 0],
  ["Tinpot", 0, 2, 0],
  ["Clunker", 0, 0, 0],
];

export function SandboxResults() {
  const players: PlayerInfo[] = STATS.map(([name, wins, totalKills], i) => ({
    id: `p${i}`,
    name,
    color: teams ? TEAMS[i % 2]!.shades[Math.floor(i / 2)]! : PLAYER_COLORS[i]!,
    isBot: i > 0,
    connected: true,
    wins,
    totalKills,
    totalDestroyed: 0,
    hullChoice: "random",
    inRound: true,
    team: i % 2,
  }));
  const room: RoomView = {
    id: "SANDBOX",
    hostId: "p0",
    phase: "results",
    phaseEndsInMs: null,
    round: 6,
    settings: { ...DEFAULT_SETTINGS, teams },
    players,
    fastForward: { votes: [], needed: 1, active: false },
    done: { votes: [], needed: 1 },
  };
  const results: RoundResults = {
    round: 6,
    winnerId: teams ? null : "p0",
    ...(teams ? { teams, winnerTeam: 0 } : {}),
    rows: STATS.map(([, , , kills], i) => ({
      playerId: `p${i}`,
      place: i + 1,
      kills,
      cellsDestroyed: 0,
      cellsLost: 0,
      survivedSeconds: 0,
      ...(teams ? { team: i % 2 } : {}),
    })),
  };
  return <Results room={room} me="p0" results={results} chat={[]} />;
}
