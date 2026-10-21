// The one WebSocket connection to the server, plus the client-side copy of room state.
// React components read state through useNet(); arena snapshots bypass React and go
// straight to subscribers because they arrive 20 times a second.
import { useSyncExternalStore } from "react";
import { REPLACED, type ChatMessage, type ClientMsg, type PlayerId, type RoomView, type RoundResults, type ServerMsg, type TableSummary } from "@ja/shared";
import type { DraftView } from "@ja/shared/draft";
import type { ArenaInit, ArenaSnapshot } from "@ja/shared/sim";

export interface NetState {
  /** "reconnecting" = dropped and retrying on its own; "closed" = won't retry (refused, or another tab has the seat). */
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
  /** The lobby's list of tables, while watching it. */
  tables: TableSummary[];
}

/** This browser's player id, from the server's welcome. Shared by every tab: one seat per browser. */
const ID_KEY = "ja.player";
/** Reconnect backoff after a drop (e.g. the server restarting), doubling up to the cap. */
const BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

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
    tables: [],
  };
  private ws: WebSocket | null = null;
  private backoff = BACKOFF_MS;
  /** Set when the server refuses us (room full, bad code): retrying won't help. */
  private refused = false;
  /** Whether the current connection has been welcomed into a room yet. */
  private welcomed = false;
  private listeners = new Set<() => void>();
  private snapListeners = new Set<(s: ArenaSnapshot) => void>();

  /** Connects without joining a table, to watch the lobby's table list. */
  openLobby() {
    this.refused = false;
    this.welcomed = false;
    const old = this.ws;
    this.ws = null;
    old?.close();
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    this.set({ status: "connecting" });
    ws.onopen = () => {
      this.backoff = BACKOFF_MS;
      this.set({ status: "open" });
      this.send({ t: "lobby" });
    };
    ws.onmessage = (e) => this.receive(JSON.parse(e.data as string) as ServerMsg);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      setTimeout(() => {
        if (this.ws === ws) this.openLobby();
      }, this.nextBackoff());
    };
  }

  /** Leaves the table for good and goes back to the lobby. */
  quit() {
    this.send({ t: "leave" });
    history.replaceState(null, "", location.pathname);
    this.set({ playerId: null, room: null, chat: [], draft: null, arenaInit: null, results: null, error: null });
    this.openLobby();
  }

  connect(name: string, roomId: string | null) {
    this.refused = false;
    this.welcomed = false;
    const old = this.ws;
    this.ws = null;
    old?.close();

    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    this.set({ status: "connecting", error: null });

    ws.onopen = () => {
      this.backoff = BACKOFF_MS;
      this.set({ status: "open" });
      this.send({ t: "hello", name, roomId: roomId ?? undefined, playerId: readId() ?? undefined });
    };
    ws.onmessage = (e) => this.receive(JSON.parse(e.data as string) as ServerMsg);
    ws.onclose = ({ code }) => {
      if (this.ws !== ws) return;
      if (code === REPLACED) {
        // Another tab or window of this browser has the seat now; reconnecting would just take it back.
        this.set({ status: "closed", error: "Playing in another tab" });
        return;
      }
      if (this.refused) {
        this.set({ status: "closed" });
        return;
      }
      // Rejoin whichever room we were in; the server recreates it if it restarted and forgot it.
      const room = this.state.room?.id ?? roomId;
      this.set({ status: "reconnecting" });
      setTimeout(() => {
        if (this.ws === ws) this.connect(name, room);
      }, this.nextBackoff());
    };
  }

  private nextBackoff(): number {
    const ms = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    return ms;
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
        writeId(msg.playerId);
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
      case "tables":
        this.set({ tables: msg.tables });
        return;
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

/** Same origin unless built with VITE_WS_URL, which the GitHub Pages deploy sets to the Render origin. */
function wsUrl(): string {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function readId(): PlayerId | null {
  try {
    return localStorage.getItem(ID_KEY);
  } catch {
    return null;
  }
}

function writeId(id: PlayerId) {
  try {
    localStorage.setItem(ID_KEY, id);
  } catch {
    // Reconnect-after-reload just won't work; nothing else depends on it.
  }
}
