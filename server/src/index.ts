import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMsg } from "@ja/shared";
import { initPhysics } from "@ja/shared/sim";
import { Room } from "./room.js";

const PORT = Number(process.env.SERVER_PORT ?? 4711);
/** Built client, served in production. In development Vite serves it and proxies /ws here. */
const STATIC_DIR = fileURLToPath(new URL("../../client/dist", import.meta.url));
const ROOM_CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;

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

const http = createServer(async (req, res) => {
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

  socket.on("message", (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data)) as ClientMsg;
    } catch {
      return;
    }

    if (msg.t === "hello") {
      if (room) return;
      const code = msg.roomId?.toUpperCase();
      room = code ? rooms.get(code) ?? null : createRoom();
      if (!room) {
        socket.send(JSON.stringify({ t: "error", message: "Room not found" }));
        socket.close();
        return;
      }
      playerId = room.join(socket, String(msg.name ?? ""), msg.playerId);
      if (!playerId) {
        socket.send(JSON.stringify({ t: "error", message: "Room is full" }));
        socket.close();
      }
      return;
    }

    if (room && playerId) room.handle(playerId, msg);
  });

  socket.on("close", () => {
    if (room && playerId) room.leave(playerId, socket);
  });
});

function createRoom(): Room {
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => ROOM_CODE_LETTERS[Math.floor(Math.random() * ROOM_CODE_LETTERS.length)]).join("");
  } while (rooms.has(code));
  const room = new Room(code);
  rooms.set(code, room);
  return room;
}

setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.emptySince !== null && Date.now() - room.emptySince > EMPTY_ROOM_TTL_MS) {
      room.stop();
      rooms.delete(code);
    }
  }
}, 30_000);

http.listen(PORT, () => console.log(`junkyard armada server on :${PORT}`));
