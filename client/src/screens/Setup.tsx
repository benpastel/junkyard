import { useState } from "react";
import { BOT_SKILLS, HULL_IDS, HULL_TIERS, MAX_PLAYERS, PACES, TEAMS, type BotSkill, type ChatMessage, type HullTier, type Pace, type RoomView } from "@ja/shared";
import { HULLS } from "@ja/shared/draft";
import { net } from "../net";
import { Chat } from "./Chat";
import { HullOutline, RandomHull } from "./HullOutline";
import { PlayerList } from "./PlayerList";
import { Segmented } from "./ui";

const PACE_LABELS: Record<Pace, string> = { frantic: "Frantic", fast: "Fast", strategic: "Strategic", unlimited: "Unlimited" };
const SKILL_LABELS: Record<BotSkill, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
const TIER_LABELS: Record<HullTier, string> = { small: "Small", medium: "Medium", large: "Large" };

/** The table between rounds: pick your ship, the host picks the settings and launches. */
export function Setup({ room, me, chat }: { room: RoomView; me: string | null; chat: ChatMessage[] }) {
  const isHost = room.hostId === me;
  const [copied, setCopied] = useState(false);
  const { settings } = room;
  const myChoice = room.players.find((p) => p.id === me)?.hullChoice ?? "random";
  const hulls = HULL_IDS.filter((h) => HULLS[h].tier === settings.tier);
  const teamsReady = !settings.teams || TEAMS.every((_, t) => room.players.some((p) => p.team === t));
  const swapTeam = (p: { id: string; team: number }) => net.send({ t: "setTeam", playerId: p.id, team: (p.team + 1) % TEAMS.length });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the link is visible to copy by hand.
    }
  };

  return (
    <div className="two-col">
      <div className="col-main">
        <section className="panel section">
          <h3>Crew</h3>
          {settings.teams ? (
            <div className="teams">
              {TEAMS.map((team, t) => (
                <div key={t} className="team">
                  <h4 style={{ color: team.color }}>{team.name}</h4>
                  <PlayerList
                    players={room.players.filter((p) => p.team === t)}
                    hostId={room.hostId}
                    me={me}
                    canKick={isHost}
                    showHull
                    swapTeam={swapTeam}
                  />
                </div>
              ))}
            </div>
          ) : (
            <PlayerList players={room.players} hostId={room.hostId} me={me} canKick={isHost} showHull />
          )}
          {isHost && room.players.length < MAX_PLAYERS && <button onClick={() => net.send({ t: "addBot" })}>Add bot</button>}
        </section>

        <section className="panel section">
          <h3>Ship</h3>
          <div className="hull-picker">
            <div className="hull-row">
              {hulls.map((h) => (
                <button key={h} className={h === myChoice ? "on" : ""} onClick={() => net.send({ t: "pickHull", hull: h })}>
                  <HullOutline hull={h} />
                  {HULLS[h].name}
                </button>
              ))}
              <button className={myChoice === "random" ? "on" : ""} onClick={() => net.send({ t: "pickHull", hull: "random" })}>
                <RandomHull />
                Random
              </button>
            </div>
          </div>
        </section>

        <section className="panel section">
          <h3>Mode</h3>
          <Segmented
            options={[
              { value: "ffa", label: "Free-for-all" },
              { value: "teams", label: "Teams" },
            ]}
            value={settings.teams ? "teams" : "ffa"}
            disabled={!isHost}
            onChange={(m) => net.send({ t: "settings", settings: { ...settings, teams: m === "teams" } })}
          />
          {settings.teams && (
            <>
              <h3>Friendly fire</h3>
              <Segmented
                options={[
                  { value: "on", label: "On" },
                  { value: "off", label: "Off" },
                ]}
                value={settings.friendlyFire ? "on" : "off"}
                disabled={!isHost}
                onChange={(f) => net.send({ t: "settings", settings: { ...settings, friendlyFire: f === "on" } })}
              />
            </>
          )}
          <h3>Class</h3>
          <Segmented
            options={HULL_TIERS.map((t) => ({ value: t, label: TIER_LABELS[t] }))}
            value={settings.tier}
            disabled={!isHost}
            onChange={(tier) => net.send({ t: "settings", settings: { ...settings, tier } })}
          />
          <h3>Build time</h3>
          <Segmented
            options={PACES.map((p) => ({ value: p, label: PACE_LABELS[p] }))}
            value={settings.pace}
            disabled={!isHost}
            onChange={(pace) => net.send({ t: "settings", settings: { ...settings, pace } })}
          />
          <h3>Bots</h3>
          <Segmented
            options={BOT_SKILLS.map((k) => ({ value: k, label: SKILL_LABELS[k] }))}
            value={settings.botSkill}
            disabled={!isHost}
            onChange={(botSkill) => net.send({ t: "settings", settings: { ...settings, botSkill } })}
          />
        </section>

        <div className="share-row">
          <span className="share-url mono">{location.href}</span>
          <button onClick={copyLink}>{copied ? "Copied" : "Copy"}</button>
        </div>

        <div className="button-row">
          {isHost && (
            <button className="primary big" disabled={room.players.length < 2 || !teamsReady} onClick={() => net.send({ t: "start" })}>
              Launch
            </button>
          )}
          <button onClick={() => net.quit()}>Quit</button>
        </div>
      </div>
      <Chat messages={chat} players={room.players} />
    </div>
  );
}
