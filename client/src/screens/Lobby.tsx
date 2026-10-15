import { useState } from "react";
import { BOT_SKILLS, HULL_IDS, HULL_TIERS, MAX_PLAYERS, PACES, type BotSkill, type ChatMessage, type Pace, type RoomView } from "@ja/shared";
import { HULLS } from "@ja/shared/draft";
import { cockpitCells } from "@ja/shared";
import { loadCameraMode, saveCameraMode } from "../arena/cameraPref";
import type { CameraMode } from "../arena/renderer";
import { net } from "../net";
import { Chat } from "./Chat";
import { PlayerList } from "./PlayerList";
import { Segmented } from "./ui";

const PACE_LABELS: Record<Pace, string> = { frantic: "Frantic", fast: "Fast", strategic: "Strategic", unlimited: "Unlimited" };
const SKILL_LABELS: Record<BotSkill, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

export function Lobby({ room, me, chat }: { room: RoomView; me: string | null; chat: ChatMessage[] }) {
  const isHost = room.hostId === me;
  const [copied, setCopied] = useState(false);
  // Each player's own view, not a room setting, so anyone can change it.
  const [camera, setCamera] = useState<CameraMode>(loadCameraMode);
  const { settings } = room;

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
          <PlayerList players={room.players} hostId={room.hostId} me={me} canKick={isHost} />
          {isHost && room.players.length < MAX_PLAYERS && <button onClick={() => net.send({ t: "addBot" })}>Add bot</button>}
        </section>

        <section className="panel section">
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
          <h3>Camera</h3>
          <Segmented
            options={[
              { value: "north", label: "Fixed" },
              { value: "ship", label: "Ship-up" },
            ]}
            value={camera}
            onChange={(mode: CameraMode) => {
              setCamera(mode);
              saveCameraMode(mode);
            }}
          />
          <h3>Hull</h3>
          <div className="hull-picker">
            {HULL_TIERS.map((tier) => (
              <div key={tier} className="hull-row">
                {HULL_IDS.filter((h) => HULLS[h].tier === tier).map((h) => (
                  <button
                    key={h}
                    className={h === settings.hull ? "on" : ""}
                    disabled={!isHost && h !== settings.hull}
                    onClick={() => net.send({ t: "settings", settings: { ...settings, hull: h } })}
                  >
                    <HullOutline rows={HULLS[h].rows} />
                    {HULLS[h].name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>

        <div className="share-row">
          <span className="share-url mono">{location.href}</span>
          <button onClick={copyLink}>{copied ? "Copied" : "Copy"}</button>
        </div>

        {isHost && (
          <button className="primary big" disabled={room.players.length < 2} onClick={() => net.send({ t: "start" })}>
            Launch
          </button>
        )}
      </div>
      <Chat messages={chat} players={room.players} />
    </div>
  );
}

function HullOutline({ rows }: { rows: string[] }) {
  const box = 80;
  const cell = box / Math.max(rows[0]!.length, rows.length);
  // The cockpit's T around the hull's C.
  const cy = rows.findIndex((r) => r.includes("C"));
  const cockpit = new Set(cockpitCells(rows[cy]!.indexOf("C"), cy).map((c) => `${c.x},${c.y}`));
  return (
    <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden>
      <g transform={`translate(${(box - rows[0]!.length * cell) / 2} ${(box - rows.length * cell) / 2})`}>
        {rows.flatMap((row, y) =>
          [...row].map((ch, x) =>
            ch === "." ? null : (
              <rect key={`${x},${y}`} x={x * cell} y={y * cell} width={cell * 0.85} height={cell * 0.85} fill={cockpit.has(`${x},${y}`) ? "var(--rust)" : "currentColor"} />
            ),
          ),
        )}
      </g>
    </svg>
  );
}
