import { useEffect, useRef, useState } from "react";
import type { ChatMessage, PlayerInfo } from "@ja/shared";
import { net } from "../net";

export function Chat({ messages, players }: { messages: ChatMessage[]; players: PlayerInfo[] }) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const colorOf = (id: string | null) => players.find((p) => p.id === id)?.color ?? "var(--text-dim)";

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div className="chat panel">
      <div className="chat-list" ref={listRef}>
        {messages.map((m, i) =>
          m.from === null ? (
            <div key={i} className="chat-system">
              {m.text}
            </div>
          ) : (
            <div key={i} className="chat-line">
              <span className="chat-name" style={{ color: colorOf(m.from) }}>
                {m.name}
              </span>
              {m.text}
            </div>
          ),
        )}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          net.send({ t: "chat", text });
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} aria-label="Chat message" />
      </form>
    </div>
  );
}
