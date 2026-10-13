// The one WebSocket connection to the server, plus the client-side copy of room state.
// React components read state through useNet(); arena snapshots bypass React and go
// straight to subscribers because they arrive 20 times a second.
import { useSyncExternalStore } from "react";
import type { ChatMessage, ClientMsg, PlayerId, RoomView, RoundResults, ServerMsg } from "@ja/shared";
import type { DraftView } from "@ja/shared/draft";
import type { ArenaInit, ArenaSnapshot } from "@ja/shared/sim";

export interface NetState {
  /** "reconnecting" = dropped and retrying on its own; "closed" = gave up. */
  status: "idle" | "connecting" | "open" | "reconnecting" | "closed";
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
/** Automatic reconnect attempts after a drop (e.g. the server restarting) before showing the button. */
const MAX_RETRIES = 10;

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
  private retries = 0;
  /** Set when the server refuses us (room full, bad code): retrying won't help. */
  private refused = false;
  /** Whether the current connection has been welcomed into a room yet. */
  private welcomed = false;
  private listeners = new Set<() => void>();
  private snapListeners = new Set<(s: ArenaSnapshot) => void>();

  connect(name: string, roomId: string | null) {
    this.refused = false;
    this.welcomed = false;
    const old = this.ws;
    this.ws = null;
    old?.close();
    const session = readSession();
    const playerId = session && roomId && session.roomId === roomId ? session.playerId : undefined;

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;
    this.set({ status: "connecting", error: null });

    ws.onopen = () => {
      this.retries = 0;
      this.set({ status: "open" });
      this.send({ t: "hello", name, roomId: roomId ?? undefined, playerId });
    };
    ws.onmessage = (e) => this.receive(JSON.parse(e.data as string) as ServerMsg);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      // Rejoin whichever room we were in; the server recreates it if it restarted and forgot it.
      const room = this.state.room?.id ?? roomId;
      if (this.refused || this.retries >= MAX_RETRIES) {
        this.set({ status: "closed" });
        return;
      }
      this.retries++;
      this.set({ status: "reconnecting" });
      setTimeout(() => {
        if (this.ws === ws) this.connect(name, room);
      }, Math.min(4000, 300 * 2 ** this.retries));
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
        this.welcomed = true;
        writeSession({ roomId: msg.roomId, playerId: msg.playerId });
        history.replaceState(null, "", `?r=${msg.roomId}`);
        // Start clean: the room may be a fresh one after a server restart.
        this.set({ playerId: msg.playerId, error: null, draft: null, arenaInit: null, results: null });
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
        if (!this.welcomed) this.refused = true;
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
