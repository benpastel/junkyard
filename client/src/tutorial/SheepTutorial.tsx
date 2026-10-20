// Tutorial: build an engines-only ship, then round up the sheep floating round the arena while
// dodging saw blades. Runs entirely in the browser (no server). Open with ?tutorial=sheep.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NO_INPUT, PLAYER_COLORS, type InputState, type PlayerInfo } from "@ja/shared";
import { Draft, ENGINES_ONLY, REROLL_SECONDS, type DraftAction } from "@ja/shared/draft";
import { Arena, SHEEP_ROUNDUP, SNAPSHOT_EVERY, TICK_HZ, initPhysics, type ArenaInit, type ArenaSnapshot } from "@ja/shared/sim";
import { ArenaScreen } from "../arena/ArenaScreen";
import { drawSheep } from "../art/sheep";
import { DraftScreen } from "../draft/DraftScreen";
import { formatTime, loadBest, saveBest } from "./best";
import "./tutorial.css";

const ME = "me";
const COLOR = PLAYER_COLORS[0];
const HULL = "skiff";
/** The result card comes up this long after the last sheep (or the ship) goes. */
const RESULT_DELAY_MS = 1800;

const PLAYERS: PlayerInfo[] = [
  { id: ME, name: "You", color: COLOR, isBot: false, connected: true, wins: 0, totalKills: 0, totalDestroyed: 0, hullChoice: HULL, inRound: true },
];

export function SheepTutorial() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void initPhysics().then(() => setReady(true));
  }, []);
  // A new build each time round; the finished ship is kept for flying again.
  const [build, setBuild] = useState(0);
  const [ship, setShip] = useState<ReturnType<Draft["blueprintCells"]> | null>(null);
  const [flight, setFlight] = useState(0);

  if (!ready) return null;
  if (!ship) return <Build key={build} onLaunch={setShip} />;
  return (
    <Fly
      key={flight}
      cells={ship}
      onAgain={() => setFlight((f) => f + 1)}
      onRebuild={() => {
        setShip(null);
        setBuild((b) => b + 1);
      }}
    />
  );
}

function Build({ onLaunch }: { onLaunch: (cells: ReturnType<Draft["blueprintCells"]>) => void }) {
  const draft = useMemo(() => new Draft({ playerIds: [ME], hull: HULL, seed: Math.floor(Math.random() * 2 ** 31), pieces: ENGINES_ONLY }), []);
  const [version, setVersion] = useState(0);
  const act = useCallback(
    (a: DraftAction) => {
      const err = draft.apply(ME, a);
      if (!err && a.type === "reroll") {
        setTimeout(() => {
          draft.finishReroll(ME);
          setVersion((v) => v + 1);
        }, REROLL_SECONDS * 1000);
      }
      setVersion((v) => v + 1);
    },
    [draft],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => draft.view(ME), [draft, version]);
  return (
    <DraftScreen
      view={view}
      me={ME}
      endsAt={null}
      act={act}
      players={PLAYERS}
      done={{ voted: false, votes: 0, needed: 1, toggle: () => onLaunch(draft.blueprintCells(ME)) }}
    />
  );
}

interface Status {
  left: number;
  total: number;
  seconds: number;
  result: { won: boolean; seconds: number; best: number | null; newBest: boolean } | null;
}

function Fly({ cells, onAgain, onRebuild }: { cells: ReturnType<Draft["blueprintCells"]>; onAgain: () => void; onRebuild: () => void }) {
  const [init, setInit] = useState<ArenaInit | null>(null);
  const [status, setStatus] = useState<Status>({ left: SHEEP_ROUNDUP.sheep!, total: SHEEP_ROUNDUP.sheep!, seconds: 0, result: null });
  const hub = useMemo(() => {
    const subs = new Set<(s: ArenaSnapshot) => void>();
    return {
      input: { ...NO_INPUT } as InputState,
      subs,
      subscribe: (cb: (s: ArenaSnapshot) => void) => {
        subs.add(cb);
        return () => subs.delete(cb);
      },
    };
  }, []);

  useEffect(() => {
    const arena = new Arena({
      ships: [{ playerId: ME, name: "You", color: COLOR, cells }],
      seed: Math.floor(Math.random() * 2 ** 31),
      scenario: SHEEP_ROUNDUP,
    });
    setInit(arena.init());
    // Development only: lets scripted checks reach the arena (scripts/check-tutorial.mjs).
    if (import.meta.env.DEV) (window as unknown as { __tutorialArena?: Arena }).__tutorialArena = arena;
    let cancelled = false;
    let last = performance.now();
    let acc = 0;
    let overAt: number | null = null;
    // Fixed-timestep loop on the wall clock, like the server.
    const timer = window.setInterval(() => {
      if (cancelled) return;
      const now = performance.now();
      acc = Math.min(acc + (now - last) / 1000, 0.25);
      last = now;
      while (acc >= 1 / TICK_HZ) {
        acc -= 1 / TICK_HZ;
        arena.step({ [ME]: hub.input });
        if (arena.tickCount % SNAPSHOT_EVERY === 0) {
          const snap = arena.snapshot();
          for (const cb of hub.subs) cb(snap);
        }
      }
      const seconds = arena.finishedSeconds ?? arena.fightSeconds;
      if (arena.over && overAt === null) overAt = now;
      let result: Status["result"] = null;
      if (overAt !== null && now - overAt >= RESULT_DELAY_MS) {
        window.clearInterval(timer);
        const won = arena.winner === ME;
        const newBest = won && saveBest(SHEEP_ROUNDUP.id, seconds);
        result = { won, seconds, best: loadBest(SHEEP_ROUNDUP.id), newBest };
      }
      setStatus((s) => (s.left === arena.sheepLeft && Math.floor(s.seconds * 10) === Math.floor(seconds * 10) && !result ? s : { left: arena.sheepLeft, total: arena.sheepTotal, seconds, result }));
    }, 1000 / TICK_HZ);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      arena.dispose();
    };
  }, [cells, hub]);

  if (!init) return null;
  return (
    <ArenaScreen
      init={init}
      me={ME}
      subscribe={hub.subscribe}
      sendInput={(i) => (hub.input = i)}
      hud={
        <>
          <div className="tut-hud mono">
            <span className="tut-count">
              <SheepIcon />
              {status.total - status.left}/{status.total}
            </span>
            <span className="tut-clock">{formatTime(status.seconds)}</span>
          </div>
          {status.result && <ResultCard result={status.result} onAgain={onAgain} onRebuild={onRebuild} />}
        </>
      }
    />
  );
}

function ResultCard({ result, onAgain, onRebuild }: { result: NonNullable<Status["result"]>; onAgain: () => void; onRebuild: () => void }) {
  return (
    <div className="tut-result-wrap">
      <div className="panel tut-result">
        {result.won ? (
          <>
            <div className="tut-time mono">{formatTime(result.seconds)}</div>
            <div className="tut-best mono">{result.newBest ? "New best" : result.best !== null ? `Best ${formatTime(result.best)}` : ""}</div>
          </>
        ) : (
          <div className="tut-time mono">Ship lost</div>
        )}
        <div className="button-row">
          <button className="primary" onClick={onAgain}>
            Fly again
          </button>
          <button onClick={onRebuild}>Rebuild</button>
          <button onClick={() => (location.href = location.pathname)}>Lobby</button>
        </div>
      </div>
    </div>
  );
}

/** A little sheep for the counter. */
function SheepIcon() {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current!;
    const size = 26;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, size / 2 * dpr, size / 2 * dpr);
    drawSheep(ctx, size / 2 - 1, { t: 0, variant: 1 });
  }, []);
  return <canvas ref={ref} className="tut-sheep" style={{ width: 26, height: 26 }} />;
}
