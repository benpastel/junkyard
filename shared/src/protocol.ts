// Every message sent over the WebSocket, in both directions. JSON-encoded.
import type { DraftAction, DraftView } from "./draft/index.js";
import type { ArenaInit, ArenaSnapshot } from "./sim/index.js";
import type { InputState, PlayerId, RoomSettings, RoundResultRow } from "./types.js";

export type Phase = "lobby" | "draft" | "arena" | "results";

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  color: string;
  isBot: boolean;
  connected: boolean;
  wins: number;
  /** Across every round in this room. */
  totalKills: number;
  totalDestroyed: number;
}

export interface RoomView {
  id: string;
  hostId: PlayerId;
  phase: Phase;
  /** Milliseconds until the current phase times out, measured when the message was sent. */
  phaseEndsInMs: number | null;
  round: number;
  settings: RoomSettings;
  players: PlayerInfo[];
  /** Fast-forward vote during a fight: it runs at FAST_FORWARD_SPEED once every connected human has voted. */
  fastForward: { votes: PlayerId[]; needed: number; active: boolean };
  /** Players who've clicked Done in the draft; the fight starts once every connected human has. */
  done: { votes: PlayerId[]; needed: number };
}

export interface ChatMessage {
  /** null for system messages. */
  from: PlayerId | null;
  name: string;
  text: string;
}

export interface RoundResults {
  round: number;
  winnerId: PlayerId | null;
  rows: RoundResultRow[];
}

export type ClientMsg =
  /** First message on every connection. Omit roomId to create a new room. */
  | { t: "hello"; name: string; roomId?: string; playerId?: PlayerId }
  | { t: "chat"; text: string }
  | { t: "settings"; settings: RoomSettings }
  | { t: "addBot" }
  | { t: "removeBot"; playerId: PlayerId }
  | { t: "start" }
  | { t: "draft"; action: DraftAction }
  | { t: "input"; input: InputState }
  | { t: "fastForward"; on: boolean }
  | { t: "done"; on: boolean }
  | { t: "nextRound" }
  | { t: "toLobby" };

export type ServerMsg =
  | { t: "welcome"; playerId: PlayerId; roomId: string }
  | { t: "room"; room: RoomView }
  | { t: "chat"; messages: ChatMessage[] }
  | { t: "draft"; view: DraftView }
  | { t: "arenaInit"; init: ArenaInit }
  | { t: "arenaSnap"; snap: ArenaSnapshot }
  | { t: "results"; results: RoundResults }
  | { t: "error"; message: string };
