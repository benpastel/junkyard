// Every message sent over the WebSocket, in both directions. JSON-encoded.
import type { DraftAction, DraftView } from "./draft/index.js";
import type { ArenaInit, ArenaSnapshot } from "./sim/index.js";
import type { HullChoice, HullTier, InputState, Pace, PlayerId, RoomSettings, RoundResultRow } from "./types.js";

/** A table's phases. "setup" is the pre-round table: pick ships and settings, then launch. */
export type Phase = "setup" | "draft" | "arena" | "results";

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
  /** Ship pick for the next round. */
  hullChoice: HullChoice;
  /** Has a ship in the current round (false for someone who joined mid-fight). */
  inRound: boolean;
}

/** One row of the lobby's table list. */
export interface TableSummary {
  id: string;
  phase: Phase;
  round: number;
  tier: HullTier;
  pace: Pace;
  players: { name: string; color: string; isBot: boolean }[];
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
  /** Watch the lobby's table list (until joining a table). */
  | { t: "lobby" }
  /** Join a table. Omit roomId to create a new one. */
  | { t: "hello"; name: string; roomId?: string; playerId?: PlayerId }
  | { t: "pickHull"; hull: HullChoice }
  | { t: "chat"; text: string }
  | { t: "settings"; settings: RoomSettings }
  | { t: "addBot" }
  | { t: "removeBot"; playerId: PlayerId }
  | { t: "start" }
  | { t: "draft"; action: DraftAction }
  | { t: "input"; input: InputState }
  | { t: "fastForward"; on: boolean }
  | { t: "done"; on: boolean }
  /** Host, from results: back to setup for the next round. */
  | { t: "nextRound" };

export type ServerMsg =
  | { t: "tables"; tables: TableSummary[] }
  | { t: "welcome"; playerId: PlayerId; roomId: string }
  | { t: "room"; room: RoomView }
  | { t: "chat"; messages: ChatMessage[] }
  | { t: "draft"; view: DraftView }
  | { t: "arenaInit"; init: ArenaInit }
  | { t: "arenaSnap"; snap: ArenaSnapshot }
  | { t: "results"; results: RoundResults }
  | { t: "error"; message: string };
