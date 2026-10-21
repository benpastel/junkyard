import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMsg, PlayerId } from "@ja/shared";
import { initPhysics } from "@ja/shared/sim";
import { Room } from "./room.js";

// Render sets PORT; SERVER_PORT is the local dev setting shared with the Vite proxy.
const PORT = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 4711);
/** Built client, served in production. In development Vite serves it and proxies /ws here. */
const STATIC_DIR = fileURLToPath(new URL("../../client/dist", import.meta.url));
const ROOM_CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
/** Bots a new room starts with, so there's someone to fight straight away. */
const DEFAULT_BOTS = 3;
/** Render's proxy drops idle websockets, and a phone that sleeps never says goodbye; a ping finds both. */
const PING_MS = 25_000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".json": "application/json",
};

await initPhysics();

const rooms = new Map<string, Room>();
/** Every browser's id (kept in its localStorage) and the table it sits at, if any. One seat per browser. */
const seats = new Map<PlayerId, string | null>();
/** Sockets on the lobby screen, sent the table list whenever it changes. */
const lobbyWatchers = new Set<WebSocket>();
let tablesQueued = false;

function tablesMessage(): string {
  const tables = [...rooms.values()].filter((r) => r.hasHumans()).map((r) => r.summary());
  return JSON.stringify({ t: "tables", tables });
}

/** Tells the lobby about table changes, at most every quarter second. */
function queueTables() {
  if (tablesQueued) return;
  tablesQueued = true;
  setTimeout(() => {
    tablesQueued = false;
    if (lobbyWatchers.size === 0) return;
    const data = tablesMessage();
    for (const s of lobbyWatchers) if (s.readyState === s.OPEN) s.send(data);
  }, 250);
}

const http = createServer(async (req, res) => {
  // Render's health check. Listening only starts once Rapier is initialised, so answering at all
  // means fights can run; anything else would fall through to index.html and always look healthy.
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!)).replace(/^(\.\.[/\\])+/, "");
  for (const candidate of [join(STATIC_DIR, path), join(STATIC_DIR, "index.html")]) {
    try {
      const body = await readFile(candidate);
      res.writeHead(200, { "content-type": MIME[extname(candidate)] ?? "application/octet-stream" });
      res.end(body);
      return;
    } catch {
      // Try the next candidate; unknown paths fall back to index.html.
    }
  }
  res.writeHead(404).end("not found");
});

const wss = new WebSocketServer({ server: http, path: "/ws" });

wss.on("connection", (socket: WebSocket) => {
  let room: Room | null = null;
  let playerId: string | null = null;

  let alive = true;
  socket.on("pong", () => {
    alive = true;
  });
  const ping = setInterval(() => {
    if (!alive) return socket.terminate();
    alive = false;
    socket.ping();
  }, PING_MS);

  socket.on("message", (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data)) as ClientMsg;
    } catch {
      return;
    }

    if (msg.t === "lobby") {
      if (room) return;
      lobbyWatchers.add(socket);
      socket.send(tablesMessage());
      return;
    }

    if (msg.t === "hello") {
      if (room) return;
      lobbyWatchers.delete(socket);
      const code = msg.roomId?.toUpperCase();
      // Rooms live in memory, so a server restart forgets them. Asking for a code that doesn't
      // exist recreates it as a fresh lobby, which keeps shared links and reconnects working.
      if (code && !isRoomCode(code)) {
        socket.send(JSON.stringify({ t: "error", message: "Room not found" }));
        socket.close();
        return;
      }
      // An id the server doesn't know (new browser, or a restart forgot it) gets a fresh one.
      const id = typeof msg.playerId === "string" && seats.has(msg.playerId) ? msg.playerId : randomUUID();
      room = code ? (rooms.get(code) ?? createRoom(code)) : createRoom();
      playerId = room.join(socket, String(msg.name ?? ""), id);
      if (!playerId) {
        socket.send(JSON.stringify({ t: "error", message: "Room is full" }));
        socket.close();
        return;
      }
      // Sitting down at a different table gives up the seat at the old one.
      const was = seats.get(id);
      if (was && was !== room.id) rooms.get(was)?.evict(id);
      seats.set(id, room.id);
      return;
    }

    if (!room || !playerId) return;
    if (msg.t === "leave") {
      room.evict(playerId);
      seats.set(playerId, null);
      return;
    }
    room.handle(playerId, msg);
  });

  socket.on("close", () => {
    clearInterval(ping);
    lobbyWatchers.delete(socket);
    if (room && playerId) room.leave(playerId, socket);
  });
});

function isRoomCode(code: string): boolean {
  return code.length === 4 && [...code].every((ch) => ROOM_CODE_LETTERS.includes(ch));
}

function createRoom(code?: string): Room {
  while (!code || rooms.has(code)) {
    code = Array.from({ length: 4 }, () => ROOM_CODE_LETTERS[Math.floor(Math.random() * ROOM_CODE_LETTERS.length)]).join("");
  }
  const room = new Room(code, DEFAULT_BOTS, queueTables);
  rooms.set(code, room);
  return room;
}

setInterval(() => {
  for (const [code, room] of rooms) {
    room.reap();
    if (room.emptySince !== null && Date.now() - room.emptySince > EMPTY_ROOM_TTL_MS) {
      room.stop();
      rooms.delete(code);
      for (const [id, at] of seats) if (at === code) seats.set(id, null);
      queueTables();
    }
  }
}, 30_000);

http.listen(PORT, () => console.log(`junkyard armada server on :${PORT}`));
