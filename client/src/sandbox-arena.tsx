// Local arena sandbox: runs the sim in the browser with bots, no server.
// ?sandbox=arena[&bots=N][&me=0][&seed=N]
import { useEffect, useMemo, useState } from "react";
import { NO_INPUT, PLAYER_COLORS, type InputState, type ShipBlueprint } from "@ja/shared";
import { Arena, SIM, SNAPSHOT_EVERY, TICK_HZ, arenaBotInput, initPhysics, type ArenaInit, type ArenaSnapshot } from "@ja/shared/sim";
import { SANDBOX_SHIPS, parseShip } from "@ja/shared/sim/testShips";
import { ArenaScreen } from "./arena/ArenaScreen";

const ME = "me";

export function SandboxArena() {
  const params = new URLSearchParams(location.search);
  const withMe = params.get("me") !== "0";
  const bots = Math.max(1, Math.min(7, Number(params.get("bots") ?? 3)));
  const seed = Number(params.get("seed") ?? 1);
  // ?shrink=20 closes the ring over 20s with no delay, for watching the endgame squeeze.
  const shrink = params.get("shrink");
  if (shrink) Object.assign(SIM, { ringDelaySeconds: 0, ringShrinkSeconds: Number(shrink) });
  // ?idle=1 keeps the bots from steering or shooting.
  const idle = params.get("idle") === "1";

  const [init, setInit] = useState<ArenaInit | null>(null);
  const [round, setRound] = useState(0);
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
    let arena: Arena | null = null;
    let timer = 0;
    let cancelled = false;
    void initPhysics().then(() => {
      if (cancelled) return;
      const ships: ShipBlueprint[] = [];
      const total = (withMe ? 1 : 0) + bots;
      for (let i = 0; i < total; i++) {
        const isMe = withMe && i === 0;
        const def = SANDBOX_SHIPS[i % SANDBOX_SHIPS.length]!;
        ships.push({
          playerId: isMe ? ME : `bot${i}`,
          name: isMe ? "You" : `${def.name}`,
          color: PLAYER_COLORS[i % PLAYER_COLORS.length]!,
          cells: parseShip(def.rows),
        });
      }
      arena = new Arena({ ships, seed: seed + round });
      setInit(arena.init());
      const a = arena;
      // Fixed-timestep loop driven by wall clock, like the server.
      let last = performance.now();
      let acc = 0;
      timer = window.setInterval(() => {
        const now = performance.now();
        acc = Math.min(acc + (now - last) / 1000, 0.25);
        last = now;
        while (acc >= 1 / TICK_HZ) {
          acc -= 1 / TICK_HZ;
          const inputs: Record<string, InputState> = {};
          for (const s of a.ships) inputs[s.playerId] = s.playerId === ME ? hub.input : idle ? NO_INPUT : arenaBotInput(a, s.playerId);
          a.step(inputs);
          if (a.tickCount % SNAPSHOT_EVERY === 0) {
            const snap = a.snapshot();
            for (const cb of hub.subs) cb(snap);
          }
        }
        if (a.over) {
          window.clearInterval(timer);
          console.log("fight over", JSON.stringify(a.results()));
          window.setTimeout(() => setRound((r) => r + 1), 2500);
        }
      }, 1000 / TICK_HZ);
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      arena?.dispose();
    };
  }, [round, withMe, bots, seed, hub]);

  if (!init) return null;
  return <ArenaScreen key={round} init={init} me={withMe ? ME : null} subscribe={hub.subscribe} sendInput={(i) => (hub.input = i)} />;
}
