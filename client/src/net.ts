// The one WebSocket connection to the server, plus the client-side copy of room state.
// React components read state through useNet(); arena snapshots bypass React and go
// straight to subscribers because they arrive 20 times a second.
import { useSyncExternalStore } from "react";
import type { ChatMessage, ClientMsg, PlayerId, RoomView, RoundResults, ServerMsg } from "@ja/shared";
import type { DraftView } from "@ja/shared/draft";
import type { ArenaInit, ArenaSnapshot } from "@ja/shared/sim";

export interface NetState {
  status: "idle" | "connecting" | "open" | "closed";
  error: string | null;
  playerId: PlayerId | null;
  room: RoomView | null;
  /** performance.now()-based deadline for the current phase. */
  phaseEndsAt: number | null;
  chat: ChatMessage[];
  draft: DraftView | null;
  arenaInit: ArenaInit | null;
  results: RoundResults | null;
}

const SESSION_KEY = "ja.session";

interface Session {
  roomId: string;
  playerId: PlayerId;
}

class Net {
  state: NetState = {
    status: "idle",
    error: null,
    playerId: null,
    room: null,
    phaseEndsAt: null,
    chat: [],
    draft: null,
    arenaInit: null,
    results: null,
  };
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private snapListeners = new Set<(s: ArenaSnapshot) => void>();

  connect(name: string, roomId: string | null) {
    this.ws?.close();
    const session = readSession();
    const playerId = session && roomId && session.roomId === roomId ? session.playerId : undefined;

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;
    this.set({ status: "connecting", error: null });

    ws.onopen = () => {
      this.set({ status: "open" });
      this.send({ t: "hello", name, roomId: roomId ?? undefined, playerId });
    };
    ws.onmessage = (e) => this.receive(JSON.parse(e.data as string) as ServerMsg);
    ws.onclose = () => {
      if (this.ws === ws) this.set({ status: "closed" });
    };
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  subscribeSnaps = (fn: (s: ArenaSnapshot) => void) => {
    this.snapListeners.add(fn);
    return () => {
      this.snapListeners.delete(fn);
    };
  };

  private receive(msg: ServerMsg) {
    switch (msg.t) {
      case "welcome":
        writeSession({ roomId: msg.roomId, playerId: msg.playerId });
        history.replaceState(null, "", `?r=${msg.roomId}`);
        this.set({ playerId: msg.playerId });
        return;
      case "room": {
        const phaseChanged = this.state.room?.phase !== msg.room.phase;
        this.set({
          room: msg.room,
          phaseEndsAt: msg.room.phaseEndsInMs === null ? null : performance.now() + msg.room.phaseEndsInMs,
          ...(phaseChanged && msg.room.phase !== "draft" ? { draft: null } : {}),
          ...(phaseChanged && msg.room.phase !== "arena" ? { arenaInit: null } : {}),
        });
        return;
      }
      case "chat":
        this.set({ chat: msg.messages });
        return;
      case "draft":
        this.set({ draft: msg.view });
        return;
      case "arenaInit":
        this.set({ arenaInit: msg.init });
        return;
      case "arenaSnap":
        for (const fn of this.snapListeners) fn(msg.snap);
        return;
      case "results":
        this.set({ results: msg.results });
        return;
      case "error":
        this.set({ error: msg.message });
        return;
    }
  }

  private set(patch: Partial<NetState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
}

export const net = new Net();

/** Re-renders the calling component whenever net state changes. */
export function useNet(): NetState {
  return useSyncExternalStore(net.subscribe, () => net.state);
}

function readSession(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
  } catch {
    return null;
  }
}

function writeSession(s: Session) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // Reconnect-after-reload just won't work; nothing else depends on it.
  }
}
