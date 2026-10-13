import { Suspense, lazy, useEffect, useRef } from "react";
import { ArenaScreen } from "./arena/ArenaScreen";
import { DraftScreen } from "./draft/DraftScreen";
import { net, useNet } from "./net";
import { Landing, storedName } from "./screens/Landing";
import { Lobby } from "./screens/Lobby";
import { Results } from "./screens/Results";
import { Waiting } from "./screens/Waiting";

// Sandboxes run the sim in the browser, so they load lazily to keep Rapier out of the main bundle.
const SandboxArena = lazy(() => import("./sandbox-arena").then((m) => ({ default: m.SandboxArena })));
const SandboxDraft = lazy(() => import("./sandbox-draft").then((m) => ({ default: m.SandboxDraft })));

const params = new URLSearchParams(location.search);
const sandbox = params.get("sandbox");

export function App() {
  if (sandbox === "arena" || sandbox === "draft") {
    return <Suspense fallback={null}>{sandbox === "arena" ? <SandboxArena /> : <SandboxDraft />}</Suspense>;
  }
  return <Game />;
}

function Game() {
  const s = useNet();
  const roomParam = params.get("r")?.toUpperCase() ?? null;

  // Returning to a room link with a remembered name (e.g. after a reload): rejoin straight away.
  const autoJoined = useRef(false);
  useEffect(() => {
    if (autoJoined.current) return;
    autoJoined.current = true;
    const name = storedName();
    if (roomParam && name) net.connect(name, roomParam);
  }, [roomParam]);

  const { room, playerId } = s;
  if (!room || !playerId) {
    return <Landing roomId={roomParam} error={s.status === "closed" ? (s.error ?? "Disconnected") : s.error} />;
  }

  let screen;
  switch (room.phase) {
    case "lobby":
      screen = <Lobby room={room} me={playerId} chat={s.chat} />;
      break;
    case "draft":
      screen = s.draft ? (
        <DraftScreen
          view={s.draft}
          me={playerId}
          endsAt={s.phaseEndsAt ?? performance.now()}
          act={(action) => net.send({ t: "draft", action })}
          players={room.players}
        />
      ) : (
        <Waiting room={room} me={playerId} chat={s.chat} endsAt={s.phaseEndsAt} />
      );
      break;
    case "arena":
      screen = s.arenaInit ? (
        <ArenaScreen init={s.arenaInit} me={playerId} subscribe={net.subscribeSnaps} sendInput={(input) => net.send({ t: "input", input })} />
      ) : (
        <Waiting room={room} me={playerId} chat={s.chat} endsAt={null} />
      );
      break;
    case "results":
      screen = <Results room={room} me={playerId} results={s.results} chat={s.chat} />;
      break;
  }

  return (
    <>
      {screen}
      {s.status === "closed" && (
        <div className="overlay">
          <div className="panel overlay-box">
            <h2>Disconnected</h2>
            <button className="primary" onClick={() => net.connect(storedName(), room.id)}>
              Reconnect
            </button>
          </div>
        </div>
      )}
    </>
  );
}
