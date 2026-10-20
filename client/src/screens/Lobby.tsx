import { useState } from "react";
import type { HullTier, Pace, Phase, TableSummary } from "@ja/shared";
import { net } from "../net";
import { formatTime, loadBest } from "../tutorial/best";

const NAME_KEY = "ja.name";

export function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

const PHASE_LABELS: Record<Phase, string> = { setup: "open", draft: "building", arena: "fighting", results: "results" };
const TIER_LABELS: Record<HullTier, string> = { small: "Small", medium: "Medium", large: "Large" };
const PACE_LABELS: Record<Pace, string> = { frantic: "Frantic", fast: "Fast", strategic: "Strategic", unlimited: "Unlimited" };

/** Every open table, plus making a new one. A name is needed either way. */
function TutorialBest({ id }: { id: string }) {
  const best = loadBest(id);
  return best !== null ? <span className="mono tutorial-best">{formatTime(best)}</span> : null;
}

export function Lobby({ tables, roomId, error }: { tables: TableSummary[]; roomId: string | null; error: string | null }) {
  const [name, setName] = useState(storedName);
  const named = name.trim().length > 0;

  const join = (roomId: string | null) => {
    const n = name.trim();
    if (!n) return;
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      // Name just won't be remembered.
    }
    net.connect(n, roomId);
  };

  return (
    <div className="landing">
      <h1 className="logo">
        Junkyard
        <br />
        Armada
      </h1>
      <form
        className="landing-form"
        onSubmit={(e) => {
          e.preventDefault();
          join(roomId);
        }}
      >
        <input autoFocus placeholder="Name" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        <button className="primary" type="submit" disabled={!named}>
          {roomId ? "Join" : "New table"}
        </button>
      </form>
      {error && <div className="error-text">{error}</div>}
      <a className="tutorial-link" href="?tutorial=sheep">
        Sheep round-up
        <TutorialBest id="sheep" />
      </a>
      {tables.length > 0 && (
        <ul className="table-list">
          {tables.map((t) => (
            <li key={t.id}>
              <button className="table-row" disabled={!named} onClick={() => join(t.id)}>
                <span className="table-players">
                  {t.players.map((p, i) => (
                    <span key={i} className={`table-player${p.isBot ? " bot" : ""}`} style={{ color: p.color }}>
                      {p.name}
                    </span>
                  ))}
                </span>
                <span className="table-meta mono">
                  {TIER_LABELS[t.tier]} · {PACE_LABELS[t.pace]}
                  {t.teams && " · Teams"}
                </span>
                <span className={`table-phase mono${t.phase === "setup" ? " open" : ""}`}>{PHASE_LABELS[t.phase]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
