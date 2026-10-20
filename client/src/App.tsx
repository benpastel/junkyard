import { Suspense, lazy, useEffect, useRef } from "react";
import type { RoomView } from "@ja/shared";
import type { ArenaInit } from "@ja/shared/sim/view";
import { ArenaScreen, type FastForward } from "./arena/ArenaScreen";
import { DraftScreen } from "./draft/DraftScreen";
import { net, useNet } from "./net";
import { Lobby, storedName } from "./screens/Lobby";
import { Setup } from "./screens/Setup";
import { Results } from "./screens/Results";
import { Waiting } from "./screens/Waiting";

// Sandboxes run the sim in the browser, so they load lazily to keep Rapier out of the main bundle.
const SandboxArena = lazy(() => import("./sandbox-arena").then((m) => ({ default: m.SandboxArena })));
const SandboxDraft = lazy(() => import("./sandbox-draft").then((m) => ({ default: m.SandboxDraft })));
const SandboxButtons = lazy(() => import("./sandbox-buttons").then((m) => ({ default: m.SandboxButtons })));
const SheepTutorial = lazy(() => import("./tutorial/SheepTutorial").then((m) => ({ default: m.SheepTutorial })));
const SandboxSheep = lazy(() => import("./sandbox-sheep").then((m) => ({ default: m.SandboxSheep })));

const params = new URLSearchParams(location.search);
const sandbox = params.get("sandbox");

export function App() {
  if (params.get("tutorial") === "sheep") {
    return (
      <Suspense fallback={null}>
        <SheepTutorial />
      </Suspense>
    );
  }
  if (sandbox === "sheep") {
    return (
      <Suspense fallback={null}>
        <SandboxSheep />
      </Suspense>
    );
  }
  if (sandbox === "buttons") {
    return (
      <Suspense fallback={null}>
        <SandboxButtons />
      </Suspense>
    );
  }
  if (sandbox === "arena" || sandbox === "draft") {
    return <Suspense fallback={null}>{sandbox === "arena" ? <SandboxArena /> : <SandboxDraft />}</Suspense>;
  }
  return <Game />;
}

function Game() {
  const s = useNet();
  const roomParam = params.get("r")?.toUpperCase() ?? null;

  // A table link with a remembered name (e.g. after a reload) joins straight away; anything
  // else shows the lobby's table list.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const name = storedName();
    if (roomParam && name) net.connect(name, roomParam);
    else net.openLobby();
  }, [roomParam]);

  const { room, playerId } = s;
  if (!room || !playerId) {
    return <Lobby tables={s.tables} roomId={roomParam} error={s.status === "closed" ? (s.error ?? "Disconnected") : s.error} />;
  }

  let screen;
  switch (room.phase) {
    case "setup":
      screen = <Setup room={room} me={playerId} chat={s.chat} />;
      break;
    case "draft":
      screen = s.draft ? (
        <DraftScreen
          view={s.draft}
          me={playerId}
          endsAt={s.phaseEndsAt}
          act={(action) => net.send({ t: "draft", action })}
          done={{
            voted: room.done.votes.includes(playerId),
            votes: room.done.votes.length,
            needed: room.done.needed,
            toggle: () => net.send({ t: "done", on: !room.done.votes.includes(playerId) }),
          }}
          players={room.players}
        />
      ) : (
        <Waiting room={room} me={playerId} chat={s.chat} endsAt={s.phaseEndsAt} />
      );
      break;
    case "arena":
      screen = s.arenaInit ? (
        <ArenaScreen
          init={s.arenaInit}
          me={playerId}
          subscribe={net.subscribeSnaps}
          sendInput={(input) => net.send({ t: "input", input })}
          fastForward={fastForwardFor(room, playerId, s.arenaInit)}
        />
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
      {(s.status === "closed" || s.status === "reconnecting") && (
        <div className="overlay">
          <div className="panel overlay-box">
            <h2>{s.status === "closed" ? "Disconnected" : "Reconnecting"}</h2>
            {s.status === "closed" && (
              <button className="primary" onClick={() => net.connect(storedName(), room.id)}>
                Reconnect
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** The viewer's fast-forward vote, if they're in this fight. */
function fastForwardFor(room: RoomView, me: string, init: ArenaInit): FastForward | undefined {
  if (!init.ships.some((sh) => sh.playerId === me)) return undefined;
  const voted = room.fastForward.votes.includes(me);
  return {
    voted,
    votes: room.fastForward.votes.length,
    needed: room.fastForward.needed,
    active: room.fastForward.active,
    toggle: () => net.send({ t: "fastForward", on: !voted }),
  };
}
