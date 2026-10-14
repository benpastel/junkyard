import type { WebSocket } from "ws";
import {
  BUILD_SECONDS_OPTIONS,
  DEFAULT_SETTINGS,
  HULL_IDS,
  MAX_PLAYERS,
  NO_INPUT,
  PLAYER_COLORS,
  Rng,
  type ChatMessage,
  type ClientMsg,
  type InputState,
  type Phase,
  type PlayerId,
  type RoomSettings,
  type RoomView,
  type RoundResults,
  type ServerMsg,
} from "@ja/shared";
import { Draft, REROLL_SECONDS, draftBotAction, type DraftAction } from "@ja/shared/draft";
import { Arena, CELEBRATE_SECONDS, FAST_FORWARD_SPEED, FightRecorder, SIM, SNAPSHOT_EVERY, TICK_HZ, arenaBotInput, type ArenaSetup } from "@ja/shared/sim";
import { saveRecording } from "./recordings.js";

const CHAT_HISTORY = 100;
const BOT_NAMES = ["Rustbucket", "Scrapjaw", "Tinpot", "Clunker", "Bolt", "Dentz", "Gearmouth", "Hubcap"];
const TICK_MS = 1000 / TICK_HZ;
/** Never simulate more than this many ticks in one go after a stall. */
const MAX_CATCHUP_TICKS = 10;

interface Player {
  id: PlayerId;
  name: string;
  color: string;
  isBot: boolean;
  socket: WebSocket | null;
  wins: number;
  /** Whether this player has a ship in the current draft / fight. */
  inRound: boolean;
  botNextActAt: number;
}

export class Room {
  readonly id: string;
  private hostId: PlayerId = "";
  private phase: Phase = "lobby";
  private phaseEndsAt: number | null = null;
  private round = 0;
  private settings: RoomSettings = { ...DEFAULT_SETTINGS };
  private players = new Map<PlayerId, Player>();
  private chat: ChatMessage[] = [];
  private rng = new Rng(Math.floor(Math.random() * 2 ** 32));
  private nextPlayerNum = 1;

  private draft: Draft | null = null;
  private arena: Arena | null = null;
  private arenaInputs: Record<PlayerId, InputState> = {};
  private arenaSetup: ArenaSetup | null = null;
  private recorder: FightRecorder | null = null;
  private lastResults: RoundResults | null = null;

  private loop: ReturnType<typeof setInterval> | null = null;
  private lastLoopAt = 0;
  private tickAccumulator = 0;
  private arenaTick = 0;
  private overTick: number | null = null;
  /** Humans who want the fight sped up; it speeds up once every connected human is in. */
  private fastVotes = new Set<PlayerId>();

  /** Wall-clock time when the last human left, for cleanup. */
  emptySince: number | null = Date.now();

  /** Bots still to add once the room's first player has joined (so the creator is listed first). */
  private pendingBots: number;

  constructor(id: string, defaultBots = 0) {
    this.id = id;
    this.pendingBots = defaultBots;
  }

  // ---------------------------------------------------------------- joining

  /** Adds a new human, or reattaches a returning one. Returns their id, or null if full. */
  join(socket: WebSocket, name: string, playerId?: PlayerId): PlayerId | null {
    const existing = playerId ? this.players.get(playerId) : undefined;
    let player: Player;
    if (existing && !existing.isBot) {
      existing.socket?.close();
      existing.socket = socket;
      existing.name = name || existing.name;
      player = existing;
    } else {
      if (this.players.size >= MAX_PLAYERS) return null;
      player = {
        id: this.newPlayerId(),
        name: cleanName(name) || "Pilot",
        color: this.freeColor(),
        isBot: false,
        socket,
        wins: 0,
        inRound: false,
        botNextActAt: 0,
      };
      this.players.set(player.id, player);
      this.system(`${player.name} joined`);
      for (; this.pendingBots > 0; this.pendingBots--) this.addBot();
    }
    if (!this.hostId || !this.players.get(this.hostId)?.socket) this.hostId = player.id;
    this.emptySince = null;

    this.send(player, { t: "welcome", playerId: player.id, roomId: this.id });
    this.broadcastRoom();
    this.send(player, { t: "chat", messages: this.chat });
    this.sendPhaseState(player);
    return player.id;
  }

  leave(playerId: PlayerId, socket: WebSocket) {
    const player = this.players.get(playerId);
    if (!player || player.socket !== socket) return;
    player.socket = null;
    if (this.phase === "lobby") {
      this.players.delete(playerId);
      this.system(`${player.name} left`);
    } else {
      this.arenaInputs[playerId] = { ...NO_INPUT };
    }
    if (this.hostId === playerId) {
      const next = [...this.players.values()].find((p) => !p.isBot && p.socket);
      this.hostId = next?.id ?? "";
    }
    if (!this.hasHumans()) this.emptySince = Date.now();
    this.broadcastRoom();
  }

  hasHumans(): boolean {
    return [...this.players.values()].some((p) => !p.isBot && p.socket);
  }

  addBot() {
    if (this.players.size >= MAX_PLAYERS) return;
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.nextPlayerNum}`;
    const bot: Player = {
      id: this.newPlayerId(),
      name,
      color: this.freeColor(),
      isBot: true,
      socket: null,
      wins: 0,
      inRound: false,
      botNextActAt: 0,
    };
    this.players.set(bot.id, bot);
  }

  // --------------------------------------------------------------- messages

  handle(playerId: PlayerId, msg: ClientMsg) {
    const player = this.players.get(playerId);
    if (!player) return;
    const isHost = playerId === this.hostId;

    switch (msg.t) {
      case "chat": {
        const text = msg.text.trim().slice(0, 300);
        if (!text) return;
        this.pushChat({ from: playerId, name: player.name, text });
        return;
      }
      case "settings": {
        if (!isHost || this.phase !== "lobby") return;
        const { buildSeconds, hull } = msg.settings;
        if ((BUILD_SECONDS_OPTIONS as readonly number[]).includes(buildSeconds)) this.settings.buildSeconds = buildSeconds;
        if ((HULL_IDS as readonly string[]).includes(hull)) this.settings.hull = hull;
        this.broadcastRoom();
        return;
      }
      case "addBot": {
        if (!isHost || this.phase !== "lobby") return;
        this.addBot();
        this.broadcastRoom();
        return;
      }
      case "removeBot": {
        if (!isHost || this.phase !== "lobby") return;
        if (this.players.get(msg.playerId)?.isBot) this.players.delete(msg.playerId);
        this.broadcastRoom();
        return;
      }
      case "start":
      case "nextRound": {
        const allowedFrom: Phase = msg.t === "start" ? "lobby" : "results";
        if (!isHost || this.phase !== allowedFrom) return;
        if (this.players.size < 2) return this.send(player, { t: "error", message: "Need at least 2 players" });
        this.startDraft();
        return;
      }
      case "toLobby": {
        if (!isHost || this.phase !== "results") return;
        this.setPhase("lobby", null);
        // Drop humans who disconnected during the game.
        for (const p of [...this.players.values()]) if (!p.isBot && !p.socket) this.players.delete(p.id);
        this.broadcastRoom();
        return;
      }
      case "draft": {
        if (this.phase !== "draft" || !this.draft || !player.inRound) return;
        const err = this.applyDraft(playerId, msg.action);
        if (err) this.send(player, { t: "error", message: err });
        this.broadcastDraft();
        return;
      }
      case "fastForward": {
        if (this.phase !== "arena" || player.isBot || !player.inRound) return;
        if (msg.on) this.fastVotes.add(playerId);
        else this.fastVotes.delete(playerId);
        this.broadcastRoom();
        return;
      }
      case "input": {
        if (this.phase !== "arena" || !player.inRound) return;
        this.arenaInputs[playerId] = sanitizeInput(msg.input);
        return;
      }
      case "hello":
        return;
    }
  }

  // ----------------------------------------------------------------- phases

  private startDraft() {
    this.round++;
    for (const p of this.players.values()) {
      p.inRound = p.isBot || p.socket !== null;
      p.botNextActAt = Date.now() + 1500 + this.rng.int(1500);
    }
    this.draft = new Draft({
      playerIds: [...this.players.values()].filter((p) => p.inRound).map((p) => p.id),
      hull: this.settings.hull,
      seed: this.rng.int(2 ** 31),
    });
    this.setPhase("draft", Date.now() + this.settings.buildSeconds * 1000);
    this.broadcastRoom();
    this.broadcastDraft();
    this.ensureLoop();
  }

  private startArena() {
    const draft = this.draft!;
    const ships = [...this.players.values()]
      .filter((p) => p.inRound)
      .map((p) => ({ playerId: p.id, name: p.name, color: p.color, cells: draft.blueprintCells(p.id) }));
    this.draft = null;
    this.arenaSetup = { ships, seed: this.rng.int(2 ** 31) };
    this.recorder = new FightRecorder();
    this.arena = new Arena(this.arenaSetup);
    this.arenaInputs = {};
    this.arenaTick = 0;
    this.overTick = null;
    this.fastVotes.clear();
    this.tickAccumulator = 0;
    this.setPhase("arena", null);
    this.broadcastRoom();
    this.broadcast({ t: "arenaInit", init: this.arena.init() });
  }

  private finishArena() {
    const arena = this.arena!;
    const rows = arena.results();
    const seconds = arena.tickCount / TICK_HZ;
    arena.dispose();
    if (this.recorder && this.arenaSetup) {
      const rec = this.recorder.finish(this.id, this.round, this.arenaSetup, { ...SIM }, rows);
      const name = (id: string) => this.players.get(id)?.name ?? id;
      const summary = rows.map((r) => `${r.place}. ${name(r.playerId)}`).join(", ");
      void saveRecording(rec).then((file) => console.log(`[${this.id}] round ${this.round} over after ${seconds.toFixed(0)}s: ${summary} -> ${file}`));
    }
    this.recorder = null;
    this.arena = null;
    const winner = rows.find((r) => r.place === 1);
    const winnerId = winner && rows.filter((r) => r.place === 1).length === 1 ? winner.playerId : null;
    if (winnerId) {
      const p = this.players.get(winnerId);
      if (p) {
        p.wins++;
        this.system(`${p.name} wins round ${this.round}`);
      }
    }
    this.lastResults = { round: this.round, winnerId, rows };
    this.setPhase("results", null);
    this.broadcastRoom();
    this.broadcast({ t: "results", results: this.lastResults });
  }

  private setPhase(phase: Phase, endsAt: number | null) {
    this.phase = phase;
    this.phaseEndsAt = endsAt;
  }

  // ------------------------------------------------------------------- loop

  private ensureLoop() {
    if (this.loop) return;
    this.lastLoopAt = performance.now();
    this.loop = setInterval(() => this.update(), 4);
  }

  stop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.arena?.dispose();
  }

  private update() {
    const now = performance.now();
    const elapsed = now - this.lastLoopAt;
    this.lastLoopAt = now;

    if (this.phase === "draft") {
      this.updateDraftBots();
      if (this.phaseEndsAt !== null && Date.now() >= this.phaseEndsAt) this.startArena();
    } else if (this.phase === "arena" && this.arena) {
      const speed = this.speed();
      this.tickAccumulator = Math.min(this.tickAccumulator + elapsed * speed, TICK_MS * MAX_CATCHUP_TICKS * speed);
      while (this.tickAccumulator >= TICK_MS && this.arena) {
        this.tickAccumulator -= TICK_MS;
        this.stepArena(this.arena);
      }
    } else if (this.loop) {
      clearInterval(this.loop);
      this.loop = null;
    }
  }

  /** Applies a draft action; a reroll deals its new hand REROLL_SECONDS later. */
  private applyDraft(playerId: PlayerId, action: DraftAction): string | null {
    const draft = this.draft;
    if (!draft) return "No draft";
    const err = draft.apply(playerId, action);
    if (!err && action.type === "reroll") {
      setTimeout(() => {
        if (this.draft !== draft) return;
        draft.finishReroll(playerId);
        this.broadcastDraft();
      }, REROLL_SECONDS * 1000);
    }
    return err;
  }

  private updateDraftBots() {
    const draft = this.draft;
    if (!draft) return;
    const now = Date.now();
    let changed = false;
    for (const p of this.players.values()) {
      if (!p.isBot || !p.inRound || now < p.botNextActAt) continue;
      p.botNextActAt = now + 1500 + this.rng.int(1500);
      const action = draftBotAction(draft, p.id, this.rng);
      if (action && this.applyDraft(p.id, action) === null) changed = true;
    }
    if (changed) this.broadcastDraft();
  }

  private stepArena(arena: Arena) {
    const inputs: Record<PlayerId, InputState> = {};
    for (const p of this.players.values()) {
      if (!p.inRound) continue;
      inputs[p.id] = p.isBot ? arenaBotInput(arena, p.id) : (this.arenaInputs[p.id] ?? NO_INPUT);
    }
    this.recorder?.record(inputs);
    arena.step(inputs);
    this.arenaTick++;
    // Same snapshot rate in real time whatever the speed, so bandwidth stays flat.
    const speed = this.speed();
    if (this.arenaTick % (SNAPSHOT_EVERY * speed) === 0) {
      const snap = arena.snapshot();
      if (speed !== 1) snap.speed = speed;
      this.broadcast({ t: "arenaSnap", snap });
    }
    // Once decided, keep the arena running a few seconds so everyone sees who won.
    if (arena.over && this.overTick === null) {
      this.overTick = this.arenaTick;
      this.broadcastRoom(); // fast-forward ends with the fight
    }
    if (this.overTick !== null && this.arenaTick - this.overTick >= CELEBRATE_SECONDS * TICK_HZ) this.finishArena();
  }

  /** Humans whose vote counts: connected and in the fight (dead ones too). */
  private fastVoters(): Player[] {
    return [...this.players.values()].filter((p) => !p.isBot && p.inRound && p.socket);
  }

  /** Sim ticks per real tick. The celebration always runs at normal speed. */
  private speed(): number {
    if (this.phase !== "arena" || !this.arena || this.arena.over) return 1;
    const voters = this.fastVoters();
    return voters.length > 0 && voters.every((p) => this.fastVotes.has(p.id)) ? FAST_FORWARD_SPEED : 1;
  }

  // -------------------------------------------------------------- outbound

  private view(): RoomView {
    return {
      id: this.id,
      hostId: this.hostId,
      phase: this.phase,
      phaseEndsInMs: this.phaseEndsAt === null ? null : Math.max(0, this.phaseEndsAt - Date.now()),
      round: this.round,
      settings: this.settings,
      fastForward: {
        votes: [...this.fastVotes].filter((id) => this.players.get(id)?.socket),
        needed: this.fastVoters().length,
        active: this.speed() !== 1,
      },
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isBot: p.isBot,
        connected: p.isBot || p.socket !== null,
        wins: p.wins,
      })),
    };
  }

  /** Catches a (re)joining player up on whatever is happening now. */
  private sendPhaseState(player: Player) {
    if (this.phase === "draft" && this.draft && player.inRound) {
      this.send(player, { t: "draft", view: this.draft.view(player.id) });
    } else if (this.phase === "arena" && this.arena) {
      this.send(player, { t: "arenaInit", init: this.arena.init() });
    } else if (this.phase === "results" && this.lastResults) {
      this.send(player, { t: "results", results: this.lastResults });
    }
  }

  private broadcastRoom() {
    this.broadcast({ t: "room", room: this.view() });
  }

  private broadcastDraft() {
    const draft = this.draft;
    if (!draft) return;
    for (const p of this.players.values()) {
      if (p.socket && p.inRound) this.send(p, { t: "draft", view: draft.view(p.id) });
    }
  }

  private system(text: string) {
    this.pushChat({ from: null, name: "", text });
  }

  private pushChat(msg: ChatMessage) {
    this.chat.push(msg);
    if (this.chat.length > CHAT_HISTORY) this.chat.splice(0, this.chat.length - CHAT_HISTORY);
    this.broadcast({ t: "chat", messages: this.chat });
  }

  private broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.socket && p.socket.readyState === p.socket.OPEN) p.socket.send(data);
    }
  }

  private send(player: Player, msg: ServerMsg) {
    if (player.socket && player.socket.readyState === player.socket.OPEN) player.socket.send(JSON.stringify(msg));
  }

  // ---------------------------------------------------------------- helpers

  private newPlayerId(): PlayerId {
    return `p${this.nextPlayerNum++}`;
  }

  private freeColor(): string {
    const used = new Set([...this.players.values()].map((p) => p.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
  }
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 16);
}

function sanitizeInput(i: InputState): InputState {
  return {
    up: !!i.up,
    down: !!i.down,
    left: !!i.left,
    right: !!i.right,
    laser: !!i.laser,
    grapple: !!i.grapple,
  };
}
