// Local arena sandbox: runs the sim in the browser with bots, no server.
// ?sandbox=arena[&bots=N][&me=0][&seed=N]
import { useEffect, useMemo, useRef, useState } from "react";
import { NO_INPUT, PLAYER_COLORS, type BotSkill, type InputState, type ShipBlueprint } from "@ja/shared";
import { Arena, CELEBRATE_SECONDS, FAST_FORWARD_SPEED, SIM, SNAPSHOT_EVERY, TICK_HZ, arenaBotInput, initPhysics, type ArenaInit, type ArenaSnapshot } from "@ja/shared/sim";
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
  // ?skill=easy|medium|hard (default hard) for the bots.
  const skill = (params.get("skill") ?? "hard") as BotSkill;

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

  // Fast-forward: you're the only human, so your vote alone speeds it up.
  const [fast, setFast] = useState(false);
  const fastRef = useRef(fast);
  fastRef.current = fast;

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
      let overAt: number | null = null;
      timer = window.setInterval(() => {
        if (cancelled) return;
        const now = performance.now();
        // Fast-forward when asked, or on its own once your ship is gone (like the server).
        const meDead = withMe && !a.ship(ME)?.alive;
        const speed = (fastRef.current || meDead) && !a.over ? FAST_FORWARD_SPEED : 1;
        acc = Math.min(acc + ((now - last) / 1000) * speed, 0.25 * speed);
        last = now;
        while (acc >= 1 / TICK_HZ) {
          acc -= 1 / TICK_HZ;
          const inputs: Record<string, InputState> = {};
          for (const s of a.ships) inputs[s.playerId] = s.playerId === ME ? hub.input : idle ? NO_INPUT : arenaBotInput(a, s.playerId, skill);
          a.step(inputs);
          if (a.tickCount % (SNAPSHOT_EVERY * speed) === 0) {
            const snap = a.snapshot();
            if (speed !== 1) snap.speed = speed;
            for (const cb of hub.subs) cb(snap);
          }
        }
        if (a.over && overAt === null) overAt = a.tickCount;
        if (overAt !== null && a.tickCount - overAt >= CELEBRATE_SECONDS * TICK_HZ) {
          window.clearInterval(timer);
          console.log("fight over", JSON.stringify(a.results()));
          window.setTimeout(() => setRound((r) => r + 1), 500);
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
  return (
    <ArenaScreen
      key={round}
      init={init}
      me={withMe ? ME : null}
      subscribe={hub.subscribe}
      sendInput={(i) => (hub.input = i)}
      fastForward={withMe ? { voted: fast, votes: fast ? 1 : 0, needed: 1, active: fast, toggle: () => setFast((f) => !f) } : undefined}
    />
  );
}
