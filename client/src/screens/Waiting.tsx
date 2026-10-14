import type { ChatMessage, RoomView } from "@ja/shared";
import { Chat } from "./Chat";
import { PlayerList } from "./PlayerList";
import { formatSeconds, useCountdown } from "./ui";

/** Shown to someone who joined mid-round, until the next round starts. */
export function Waiting({ room, me, chat, endsAt }: { room: RoomView; me: string | null; chat: ChatMessage[]; endsAt: number | null }) {
  const left = useCountdown(endsAt);
  return (
    <div className="two-col">
      <div className="col-main">
        <div className="room-code-row">
          <div className="room-code mono">{room.id}</div>
          <span className="phase-tag mono">
            {room.phase}
            {left !== null && ` ${formatSeconds(left)}`}
          </span>
        </div>
        <section className="panel section">
          <PlayerList players={room.players} hostId={room.hostId} me={me} canKick={false} />
        </section>
      </div>
      <Chat messages={chat} players={room.players} />
    </div>
  );
}
