import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  DEFAULT_SETTINGS,
  HULL_IDS,
  HULL_TIERS,
  BOT_SKILLS,
  MAX_PLAYERS,
  PACES,
  NO_INPUT,
  PLAYER_COLORS,
  REPLACED,
  Rng,
  TEAMS,
  type BotSkill,
  type ChatMessage,
  type ClientMsg,
  type HullChoice,
  type HullId,
  type HullTier,
  type InputState,
  type Phase,
  type PlayerId,
  type RoomSettings,
  type RoomView,
  type RoundResults,
  type ServerMsg,
  type TableSummary,
} from "@ja/shared";
import { Draft, HULLS, REROLL_SECONDS, buildSeconds, draftBotAction, type DraftAction } from "@ja/shared/draft";
import { Arena, CELEBRATE_SECONDS, FAST_FORWARD_SPEED, FightRecorder, SIM, SNAPSHOT_EVERY, TICK_HZ, arenaBotInput, type ArenaSetup } from "@ja/shared/sim";
import { saveRecording } from "./recordings.js";

const CHAT_HISTORY = 100;
/** How long a dropped human keeps their seat between rounds (long enough to reload, or for a phone to wake up). */
const SEAT_GRACE_MS = 120_000;
/** Shortest wait between a bot's draft actions (up to twice this), by skill. */
const DRAFT_BOT_MS: Record<BotSkill, number> = { easy: 3750, medium: 2400, hard: 1500 };
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
  totalKills: number;
  totalDestroyed: number;
  hullChoice: HullChoice;
  /** Whether this player has a ship in the current draft / fight. */
  inRound: boolean;
  /** Index into TEAMS (used when the table plays teams). */
  team: number;
  botNextActAt: number;
  /** When a human's socket dropped; their seat is kept for SEAT_GRACE_MS in case they come back. */
  offlineSince: number | null;
}

export class Room {
  readonly id: string;
  private hostId: PlayerId = "";
  private phase: Phase = "setup";
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
  private lastSpeed = 1;
  /** Humans who want the fight sped up; it speeds up once every connected human is in. */
  private fastVotes = new Set<PlayerId>();
  /** Humans who've finished building; the fight starts once every connected human has. */
  private doneVotes = new Set<PlayerId>();

  /** Wall-clock time when the last human left, for cleanup. */
  emptySince: number | null = Date.now();

  /** Bots still to add once the room's first player has joined (so the creator is listed first). */
  private pendingBots: number;

  /** Called whenever the room's public state changes (the lobby's table list watches this). */
  private readonly onChange: () => void;

  constructor(id: string, defaultBots = 0, onChange: () => void = () => {}) {
    this.id = id;
    this.pendingBots = defaultBots;
    this.onChange = onChange;
  }

  // ---------------------------------------------------------------- joining

  /** Adds a new human, or reattaches a returning one. Returns their id, or null if full. */
  join(socket: WebSocket, name: string, playerId: PlayerId): PlayerId | null {
    const existing = this.players.get(playerId);
    let player: Player;
    if (existing && !existing.isBot) {
      // Another tab of the same browser taking the seat over: tell the old one so it stops reconnecting.
      existing.socket?.close(REPLACED, "replaced");
      existing.socket = socket;
      existing.offlineSince = null;
      // A rejoin keeps the name they had here (they may have renamed themselves at the table).
      player = existing;
    } else {
      if (this.players.size >= MAX_PLAYERS) return null;
      player = {
        id: playerId,
        name: cleanName(name) || "Pilot",
        color: this.freeColor(),
        isBot: false,
        socket,
        wins: 0,
        totalKills: 0,
        totalDestroyed: 0,
        hullChoice: "random",
        inRound: false,
        team: this.smallerTeam(),
        botNextActAt: 0,
        offlineSince: null,
      };
      this.players.set(player.id, player);
      this.system(`${player.name} joined`);
      for (; this.pendingBots > 0; this.pendingBots--) this.addBot();
    }
    // Joining mid-build: start a ship of your own with whatever time is left.
    // Mid-fight (or on the results) you watch until the next round.
    if (this.phase === "draft" && this.draft && !this.draft.has(player.id)) {
      if (!existing) player.team = this.smallerTeam(true);
      player.inRound = true;
      this.draft.addPlayer(player.id, this.resolveHull(player.hullChoice));
      this.broadcastDraft();
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
    player.offlineSince = Date.now();
    this.arenaInputs[playerId] = { ...NO_INPUT };
    if (this.hostId === playerId) {
      const next = [...this.players.values()].find((p) => !p.isBot && p.socket);
      this.hostId = next?.id ?? "";
    }
    if (!this.hasHumans()) this.emptySince = Date.now();
    this.broadcastRoom();
  }

  /** A player quit or went to another table: their seat goes now (in setup), or at the next round. */
  evict(playerId: PlayerId) {
    const player = this.players.get(playerId);
    if (!player || player.isBot) return;
    const socket = player.socket;
    if (socket) {
      this.leave(playerId, socket);
      socket.close(REPLACED, "moved");
    }
    player.offlineSince = 0;
    this.reap();
  }

  /** Between rounds, drops humans who've been gone longer than the grace period. */
  reap() {
    if (this.phase !== "setup") return;
    const cutoff = Date.now() - SEAT_GRACE_MS;
    let changed = false;
    for (const p of [...this.players.values()]) {
      if (p.isBot || p.offlineSince === null || p.offlineSince > cutoff) continue;
      this.players.delete(p.id);
      this.system(`${p.name} left`);
      changed = true;
    }
    if (changed) this.broadcastRoom();
  }

  hasHumans(): boolean {
    return [...this.players.values()].some((p) => !p.isBot && p.socket);
  }

  addBot() {
    if (this.players.size >= MAX_PLAYERS) return;
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.nextPlayerNum++}`;
    const bot: Player = {
      id: randomUUID(),
      name,
      color: this.freeColor(),
      isBot: true,
      socket: null,
      wins: 0,
      totalKills: 0,
      totalDestroyed: 0,
      hullChoice: "random",
      inRound: false,
      team: this.smallerTeam(),
      botNextActAt: 0,
      offlineSince: null,
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
        if (!isHost || this.phase !== "setup") return;
        const { pace, tier, botSkill, teams, friendlyFire } = msg.settings;
        if ((PACES as readonly string[]).includes(pace)) this.settings.pace = pace;
        if (typeof teams === "boolean") this.settings.teams = teams;
        if (typeof friendlyFire === "boolean") this.settings.friendlyFire = friendlyFire;
        if ((BOT_SKILLS as readonly string[]).includes(botSkill)) this.settings.botSkill = botSkill;
        if ((HULL_TIERS as readonly string[]).includes(tier) && tier !== this.settings.tier) {
          this.settings.tier = tier;
          // Picks from the old class don't carry over.
          for (const p of this.players.values()) p.hullChoice = "random";
        }
        this.broadcastRoom();
        return;
      }
      case "pickHull": {
        // Applies to the next round, so it can change any time.
        if (msg.hull !== "random" && !tierHulls(this.settings.tier).includes(msg.hull)) return;
        player.hullChoice = msg.hull;
        this.broadcastRoom();
        return;
      }
      case "setName": {
        const name = cleanName(msg.name);
        if (this.phase !== "setup" || !name || name === player.name) return;
        this.system(`${player.name} is now ${name}`);
        player.name = name;
        this.broadcastRoom();
        return;
      }
      case "setColor": {
        if (this.phase !== "setup" || !(PLAYER_COLORS as readonly string[]).includes(msg.color)) return;
        if ([...this.players.values()].some((p) => p !== player && p.color === msg.color)) return;
        player.color = msg.color;
        this.broadcastRoom();
        return;
      }
      case "setTeam": {
        if (this.phase !== "setup" || (msg.playerId !== playerId && !isHost)) return;
        const target = this.players.get(msg.playerId);
        if (!target || !Number.isInteger(msg.team) || msg.team < 0 || msg.team >= TEAMS.length) return;
        target.team = msg.team;
        this.broadcastRoom();
        return;
      }
      case "addBot": {
        if (!isHost || this.phase !== "setup") return;
        this.addBot();
        this.broadcastRoom();
        return;
      }
      case "removeBot": {
        if (!isHost || this.phase !== "setup") return;
        if (this.players.get(msg.playerId)?.isBot) this.players.delete(msg.playerId);
        this.broadcastRoom();
        return;
      }
      case "start": {
        if (!isHost || this.phase !== "setup") return;
        if ([...this.players.values()].filter((p) => p.isBot || p.socket).length < 2) return this.send(player, { t: "error", message: "Need at least 2 players" });
        if (this.settings.teams && !this.bothTeamsManned()) return this.send(player, { t: "error", message: "Both teams need a player" });
        this.startDraft();
        return;
      }
      case "nextRound": {
        if (!isHost || this.phase !== "results") return;
        this.setPhase("setup", null);
        for (const p of this.players.values()) p.inRound = false;
        this.reap();
        this.broadcastRoom();
        return;
      }
      case "draft": {
        if (this.phase !== "draft" || !this.draft || !player.inRound) return;
        const err = this.applyDraft(playerId, msg.action);
        if (err) this.send(player, { t: "error", message: err });
        this.broadcastDraft();
        this.broadcastRoom(); // the Done count changes when a ship fills up
        return;
      }
      case "done": {
        if (this.phase !== "draft" || player.isBot || !player.inRound) return;
        if (msg.on) this.doneVotes.add(playerId);
        else this.doneVotes.delete(playerId);
        this.broadcastRoom();
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
      p.botNextActAt = Date.now() + this.draftBotDelay();
    }
    const builders = [...this.players.values()].filter((p) => p.inRound);
    const hulls: Partial<Record<PlayerId, HullId>> = {};
    for (const p of builders) hulls[p.id] = this.resolveHull(p.hullChoice);
    this.draft = new Draft({
      playerIds: builders.map((p) => p.id),
      hull: tierHulls(this.settings.tier)[0]!,
      hulls,
      seed: this.rng.int(2 ** 31),
    });
    const seconds = buildSeconds(this.settings.pace, tierHulls(this.settings.tier)[0]!);
    this.doneVotes.clear();
    this.setPhase("draft", seconds === null ? null : Date.now() + seconds * 1000);
    this.broadcastRoom();
    this.broadcastDraft();
    this.ensureLoop();
  }

  private startArena() {
    const draft = this.draft!;
    const ships = [...this.players.values()]
      .filter((p) => p.inRound)
      .map((p) => ({
        playerId: p.id,
        name: p.name,
        color: this.colorOf(p),
        cells: draft.blueprintCells(p.id),
        ...(this.settings.teams ? { team: p.team } : {}),
      }));
    this.draft = null;
    this.arenaSetup = { ships, seed: this.rng.int(2 ** 31), ...(this.settings.teams ? { friendlyFire: this.settings.friendlyFire } : {}) };
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
    for (const r of rows) {
      const p = this.players.get(r.playerId);
      if (!p) continue;
      p.totalKills += r.kills;
      p.totalDestroyed += r.cellsDestroyed;
    }
    // The arena's call: a draw (everyone down) has no winner even though someone placed first.
    const winnerId = arena.winner;
    const winnerTeam = arena.winnerTeam;
    if (winnerId) {
      const p = this.players.get(winnerId);
      if (p) {
        p.wins++;
        this.system(`${p.name} wins round ${this.round}`);
      }
    }
    // A team win counts for everyone on the team, shot down or not.
    if (winnerTeam !== null) {
      for (const r of rows) if (r.team === winnerTeam) this.players.get(r.playerId)!.wins++;
      this.system(`${TEAMS[winnerTeam]!.name} wins round ${this.round}`);
    }
    const teams = rows.some((r) => r.team !== undefined);
    this.lastResults = { round: this.round, winnerId, rows, ...(teams ? { teams, winnerTeam } : {}) };
    this.setPhase("results", null);
    this.broadcastRoom();
    this.broadcast({ t: "results", results: this.lastResults });
  }

  /** A player's pick for this round, with "random" (or a pick from another class) rolled within the tier. */
  private resolveHull(choice: HullChoice): HullId {
    const options = tierHulls(this.settings.tier);
    return choice !== "random" && options.includes(choice) ? choice : this.rng.pick(options);
  }

  /** This table's row in the lobby list. */
  summary(): TableSummary {
    return {
      id: this.id,
      phase: this.phase,
      round: this.round,
      tier: this.settings.tier,
      pace: this.settings.pace,
      teams: this.settings.teams,
      players: [...this.players.values()]
        .filter((p) => p.isBot || p.socket)
        .map((p) => ({ name: p.name, color: this.colorOf(p), isBot: p.isBot })),
    };
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
      const timeUp = this.phaseEndsAt !== null && Date.now() >= this.phaseEndsAt;
      if (timeUp || this.everyoneDone()) this.startArena();
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

  /** Milliseconds a bot waits between draft actions: easier bots build more slowly. */
  private draftBotDelay(): number {
    const base = DRAFT_BOT_MS[this.settings.botSkill];
    return base + this.rng.int(base);
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
      p.botNextActAt = now + this.draftBotDelay();
      const action = draftBotAction(draft, p.id, this.rng);
      if (action && this.applyDraft(p.id, action) === null) changed = true;
    }
    if (changed) this.broadcastDraft();
  }

  private stepArena(arena: Arena) {
    const inputs: Record<PlayerId, InputState> = {};
    for (const p of this.players.values()) {
      if (!p.inRound) continue;
      inputs[p.id] = p.isBot ? arenaBotInput(arena, p.id, this.settings.botSkill) : (this.arenaInputs[p.id] ?? NO_INPUT);
    }
    this.recorder?.record(inputs);
    arena.step(inputs);
    this.arenaTick++;
    // Same snapshot rate in real time whatever the speed, so bandwidth stays flat.
    const speed = this.speed();
    // Tell everyone when the speed changes on its own (e.g. the last human just died).
    if (speed !== this.lastSpeed) {
      this.lastSpeed = speed;
      this.broadcastRoom();
    }
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

  /** Every connected human in the draft is done: clicked Done, or nothing fits on their ship. */
  private everyoneDone(): boolean {
    const builders = this.fastVoters();
    return builders.length > 0 && builders.every((p) => this.isDone(p.id));
  }

  private isDone(id: PlayerId): boolean {
    return this.doneVotes.has(id) || (this.phase === "draft" && !!this.draft?.isFull(id));
  }

  /** Sim ticks per real tick. The celebration always runs at normal speed. */
  private speed(): number {
    if (this.phase !== "arena" || !this.arena || this.arena.over) return 1;
    const voters = this.fastVoters();
    // Once every human is dead there's nobody to wait for: speed up on its own.
    const arena = this.arena;
    if (voters.length > 0 && voters.every((p) => !arena.ship(p.id)?.alive)) return FAST_FORWARD_SPEED;
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
      done: {
        votes: this.fastVoters()
          .map((p) => p.id)
          .filter((id) => this.isDone(id)),
        needed: this.phase === "draft" ? this.fastVoters().length : 0,
      },
      fastForward: {
        votes: [...this.fastVotes].filter((id) => this.players.get(id)?.socket),
        needed: this.fastVoters().length,
        active: this.speed() !== 1,
      },
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: this.colorOf(p),
        isBot: p.isBot,
        connected: p.isBot || p.socket !== null,
        wins: p.wins,
        totalKills: p.totalKills,
        totalDestroyed: p.totalDestroyed,
        hullChoice: p.hullChoice,
        inRound: p.inRound,
        team: p.team,
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
    this.onChange();
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

  /** The team with fewer players (of those in the round, if asked), for a newcomer. Ties go to the first. */
  private smallerTeam(inRound = false): number {
    const counts = TEAMS.map(() => 0);
    for (const p of this.players.values()) if (!inRound || p.inRound) counts[p.team]!++;
    return counts.indexOf(Math.min(...counts));
  }

  private bothTeamsManned(): boolean {
    const players = [...this.players.values()].filter((p) => p.isBot || p.socket);
    return TEAMS.every((_, t) => players.some((p) => p.team === t));
  }

  /** A player's colour: their own, or in a team game a shade of their team's (by join order). */
  private colorOf(player: Player): string {
    if (!this.settings.teams) return player.color;
    const mates = [...this.players.values()].filter((p) => p.team === player.team);
    const shades = TEAMS[player.team]!.shades;
    return shades[mates.indexOf(player) % shades.length]!;
  }

  private freeColor(): string {
    const used = new Set([...this.players.values()].map((p) => p.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
  }
}

function tierHulls(tier: HullTier): HullId[] {
  return HULL_IDS.filter((h) => HULLS[h].tier === tier);
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
    rotLeft: !!i.rotLeft,
    rotRight: !!i.rotRight,
    laser: !!i.laser,
    grapple: !!i.grapple,
  };
}
