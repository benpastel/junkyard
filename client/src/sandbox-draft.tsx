// Local draft sandbox: me plus three bots, all in the browser. Open with ?sandbox=draft.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PLAYER_COLORS, Rng, type HullId, type PlayerInfo } from "@ja/shared";
import { Draft, draftBotAction, type DraftAction } from "@ja/shared/draft";
import { DraftScreen } from "./draft/DraftScreen";

const BUILD_SECONDS = 60;
const ME = "me";
const BOTS = ["bot1", "bot2", "bot3"];

export function SandboxDraft() {
  const params = new URLSearchParams(location.search);
  const hull = (params.get("hull") as HullId | null) ?? "hauler";
  const seed = Number(params.get("seed") ?? 1);

  const draft = useMemo(() => new Draft({ playerIds: [ME, ...BOTS], hull, seed }), [hull, seed]);
  const [version, setVersion] = useState(0);
  const endsAt = useRef(performance.now() + Number(params.get("seconds") ?? BUILD_SECONDS) * 1000);
  const over = () => performance.now() >= endsAt.current;

  const players: PlayerInfo[] = useMemo(
    () =>
      [ME, ...BOTS].map((id, i) => ({
        id,
        name: id === ME ? "You" : ["Rustbucket", "Clank", "Scrapper"][i - 1]!,
        color: PLAYER_COLORS[i]!,
        isBot: id !== ME,
        connected: true,
        wins: 0,
      })),
    [],
  );

  const act = useCallback(
    (a: DraftAction) => {
      if (over()) return;
      const err = draft.apply(ME, a);
      if (err) console.log("draft:", err);
      setVersion((v) => v + 1);
    },
    [draft],
  );

  useEffect(() => {
    if (params.get("bots") === "off") return;
    const rng = new Rng(seed + 1000);
    const timers = BOTS.map((id) => {
      const loop = () => {
        if (over()) return;
        const a = draftBotAction(draft, id, rng);
        if (a) draft.apply(id, a);
        setVersion((v) => v + 1);
        handle = setTimeout(loop, 1500 + rng.next() * 1500);
      };
      let handle = setTimeout(loop, 800 + rng.next() * 1500);
      return () => clearTimeout(handle);
    });
    return () => timers.forEach((stop) => stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => draft.view(ME), [draft, version]);

  return <DraftScreen view={view} me={ME} endsAt={endsAt.current} act={act} players={players} />;
}
